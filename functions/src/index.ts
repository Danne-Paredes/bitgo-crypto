/**
 * Casino cashier backend — Firebase Cloud Functions (v2).
 *
 * Exposes the `cashier` HTTPS function (an Express app) with:
 *   POST /cashier/deposit-intent      → generate a BitGo deposit address
 *   GET  /cashier/intent/:receiptId   → poll deposit status (UI state machine)
 *   PATCH/cashier/intent/:receiptId   → cashier-side status transition
 *   POST /cashier/webhook             → BitGo confirmed-deposit webhook
 *
 * Plus a scheduled `expireIntents` function to clean up stale intents.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { randomBytes } from 'crypto';

import { config, isBitGoConfigured } from './config.js';
import { createDepositAddress, screenAddress } from './bitgo.js';
import {
  createIntent,
  getIntent,
  setStatus,
  expireStaleIntents,
} from './firestore.js';
import { verifyWebhookSignature, handleWebhookEvent } from './webhook.js';
import type {
  DepositIntentRecord,
  DepositIntentResponse,
  DepositStatusResponse,
} from './types.js';

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

console.log('[index] Module loaded, building Express app...');

const app = express();
app.use(cors({ origin: true }));

// Capture the raw body for the webhook route so we can verify the HMAC.
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const bytes32 = (): string => '0x' + randomBytes(32).toString('hex');

/** Health check. */
app.get('/health', (_req, res) => {
  res.json({ ok: true, bitgoConfigured: isBitGoConfigured(), coin: config.bitgo.coin });
});

/**
 * POST /cashier/deposit-intent
 * Body: { amount: string|number, playerRef?: string, createdByEmail?: string }
 * Generates a unique BitGo forwarder address and persists an AWAITING intent.
 */
app.post('/deposit-intent', async (req: Request, res: Response) => {
  console.log('[index] deposit-intent handler invoked, amount:', req.body?.amount);
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (amount < config.cashier.minDepositUsdc || amount > config.cashier.maxDepositUsdc) {
      return res.status(400).json({
        error: `Amount must be between ${config.cashier.minDepositUsdc} and ${config.cashier.maxDepositUsdc} USDC`,
      });
    }
    if (!isBitGoConfigured()) {
      return res.status(503).json({ error: 'BitGo is not configured on the server' });
    }

    const receiptId = bytes32();
    const playerRef =
      typeof req.body?.playerRef === 'string' && req.body.playerRef.startsWith('0x')
        ? req.body.playerRef
        : bytes32();

    const { address, addressId } = await createDepositAddress(receiptId);

    const now = Date.now();
    const expiresAt = now + config.cashier.intentTtlMinutes * 60_000;
    const chipsPerUsdc = config.cashier.chipsPerUsdc;

    const record: DepositIntentRecord = {
      receiptId,
      playerRef,
      depositAddress: address,
      bitgoAddressId: addressId,
      coin: config.bitgo.coin,
      usdcAmount: amount,
      chipsAmount: amount * chipsPerUsdc,
      chipsPerUsdc,
      status: 'AWAITING',
      createdByEmail:
        typeof req.body?.createdByEmail === 'string' ? req.body.createdByEmail : null,
      detectedTxHash: null,
      confirmedTxHash: null,
      receivedAmount: null,
      sourceAddress: null,
      compliance: null,
      createdAt: now,
      expiresAt,
      detectedAt: null,
      confirmedAt: null,
      completedAt: null,
      updatedAt: now,
    };

    await createIntent(record);

    const response: DepositIntentResponse = {
      receiptId,
      playerRef,
      depositAddress: address,
      coin: config.bitgo.coin,
      usdcAmount: amount,
      chipsAmount: record.chipsAmount,
      chipsPerUsdc,
      status: 'AWAITING',
      createdAt: now,
      expiresAt,
    };
    return res.status(201).json(response);
  } catch (err: any) {
    console.error('deposit-intent error:', err);
    return res.status(500).json({ error: err?.message ?? 'Failed to create deposit intent' });
  }
});

/**
 * GET /cashier/intent/:receiptId
 * Polled by the frontend to drive the Awaiting → Detected → Confirmed UI.
 */
app.get('/intent/:receiptId', async (req: Request, res: Response) => {
  try {
    const intent = await getIntent(req.params.receiptId);
    if (!intent) return res.status(404).json({ error: 'Intent not found' });

    const response: DepositStatusResponse = {
      receiptId: intent.receiptId,
      status: intent.status,
      depositAddress: intent.depositAddress,
      usdcAmount: intent.usdcAmount,
      chipsAmount: intent.chipsAmount,
      receivedAmount: intent.receivedAmount,
      detectedTxHash: intent.detectedTxHash,
      confirmedTxHash: intent.confirmedTxHash,
      compliance: intent.compliance,
      expiresAt: intent.expiresAt,
      detectedAt: intent.detectedAt,
      confirmedAt: intent.confirmedAt,
      completedAt: intent.completedAt,
    };
    return res.json(response);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Failed to load intent' });
  }
});

/**
 * PATCH /cashier/intent/:receiptId
 * Cashier-side transition (e.g. cancel, or manually complete after review).
 * Body: { status: DepositStatus }
 */
app.patch('/intent/:receiptId', async (req: Request, res: Response) => {
  try {
    const intent = await getIntent(req.params.receiptId);
    if (!intent) return res.status(404).json({ error: 'Intent not found' });

    const status = req.body?.status as DepositIntentRecord['status'] | undefined;
    const allowed: DepositIntentRecord['status'][] = ['EXPIRED', 'FAILED', 'COMPLETED', 'DETECTED'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Unsupported status transition' });
    }

    const extras: Partial<DepositIntentRecord> = {};
    if (req.body?.txHash) extras.confirmedTxHash = req.body.txHash;
    if (req.body?.detectedTxHash) extras.detectedTxHash = req.body.detectedTxHash;
    if (status === 'DETECTED') extras.detectedAt = Date.now();
    if (status === 'COMPLETED') extras.completedAt = Date.now();

    await setStatus(req.params.receiptId, status, extras);
    return res.json({ ok: true, status });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Failed to update intent' });
  }
});

/**
 * POST /cashier/webhook
 * BitGo confirmed-deposit webhook. HMAC-verified, then advances the intent.
 */
app.post('/webhook', async (req: Request & { rawBody?: Buffer }, res: Response) => {
  console.log('[webhook] received request, headers:', JSON.stringify(req.headers));
  const signature = (req.header('x-signature-sha256') ??
    req.header('BitGo-Signature') ??
    req.header('bitgo-signature')) as string | undefined;
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  console.log('[webhook] rawBody present:', !!req.rawBody, 'body keys:', Object.keys(req.body ?? {}));

  if (!verifyWebhookSignature(raw, signature)) {
    console.warn('webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const result = await handleWebhookEvent(req.body ?? {});
    // Always 200 on a verified event so BitGo does not retry indefinitely.
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('webhook handler error:', err);
    return res.status(200).json({ ok: false, message: err?.message ?? 'handler error' });
  }
});

// Re-export screening for potential admin/manual use.
export { screenAddress };

export const cashier = onRequest(
  {
    cors: true,
    timeoutSeconds: 60,
    memory: "1GiB",
    invoker: "public",
  },
  app
);

/** Scheduled cleanup: expire stale AWAITING intents every 10 minutes. */
export const expireIntents = onSchedule('every 10 minutes', async () => {
  const n = await expireStaleIntents();
  if (n > 0) console.log(`expired ${n} stale intents`);
});
