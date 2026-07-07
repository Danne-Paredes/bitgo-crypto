/**
 * BitGo webhook handling.
 *
 * BitGo POSTs transfer / address notifications to our endpoint. We:
 *   1. Verify the HMAC-SHA256 signature using BITGO_WEBHOOK_SECRET.
 *   2. Resolve the deposit intent from the on-chain address.
 *   3. Verify the received amount against the expected amount.
 *   4. Advance the state machine to CONFIRMED (then COMPLETED if compliance ok).
 */
import crypto from 'crypto';
import { config } from './config.js';
import { getBitGo, getWallet, screenAddress } from './bitgo.js';
import { getIntentByAddress, setStatus, updateIntent, getActiveIntents } from './firestore.js';
import type { DepositIntentRecord } from './types.js';

/**
 * Verify a BitGo webhook signature.
 * BitGo signs the raw JSON body with HMAC-SHA256 keyed by the webhook secret.
 * The signature arrives in the `BitGo-Signature` header (hex).
 */
export const verifyWebhookSignature = (
  rawBody: Buffer | string,
  signature: string | undefined
): boolean => {
  if (!config.bitgo.webhookSecret) {
    console.warn('webhook secret not configured');
    return false;
  }
  if (!signature) {
    console.warn('no signature header');
    return false;
  }

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
  const expected = crypto
    .createHmac('sha256', config.bitgo.webhookSecret)
    .update(body)
    .digest('hex');

  console.log('[webhook] signature header:', signature.substring(0, 20) + '...');
  console.log('[webhook] computed signature:', expected.substring(0, 20) + '...');
  console.log('[webhook] secret prefix:', config.bitgo.webhookSecret.substring(0, 8) + '...');
  console.log('[webhook] raw body length:', body.length);

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) {
    console.log('[webhook] signature length mismatch:', a.length, 'vs', b.length);
    return false;
  }
  const match = crypto.timingSafeEqual(a, b);
  console.log('[webhook] signature match:', match);
  return match;
};

const USDC_DECIMALS = 6;
const toUsdc = (baseUnits: string | number): number =>
  Number(baseUnits) / 10 ** USDC_DECIMALS;

interface BitGoTransferEvent {
  type?: string;
  coin?: string;
  wallet?: string;
  transfer?: string; // transfer id
  hash?: string;
  state?: string;
  address?: string;
  baseValue?: number | string;
  value?: number | string;
  valueString?: string;
  baseValueString?: string;
  tokenValue?: number | string;
}

/**
 * Process a verified webhook payload.
 * Returns a short status string for logging / the HTTP response.
 */
export const handleWebhookEvent = async (
  payload: BitGoTransferEvent
): Promise<{ ok: boolean; message: string }> => {
  console.log('[webhook] full payload:', JSON.stringify(payload));
  const type = payload?.type ?? '';

  // We only act on confirmed transfers / receives.
  if (!/transfer|receive|confirmation/i.test(type)) {
    return { ok: true, message: `Ignored event type: ${type || 'unknown'}` };
  }

  // The webhook payload already contains value, coin, hash, and state.
  // We no longer fetch the full transfer via SDK since token transfers
  // aren't available through the base-coin wallet endpoint anyway.
  // The fallback logic below will match intents by coin + amount.
  let transfer: any = null;

  // Determine which of our deposit addresses received funds.
  // Try the payload first, then the fetched transfer details.
  const destAddress: string | null =
    payload.address ??
    transfer?.entries?.find((e: any) => e.value > 0 && !e.wallet)?.address ??
    transfer?.outputs?.find((o: any) => o.value > 0)?.address ??
    null;

  // If we couldn't find an address but the payload has a confirmed transfer with value,
  // try to find the intent by querying all active intents since we have the coin and amount.
  let intent: DepositIntentRecord | null = null;
  if (destAddress) {
    intent = await getIntentByAddress(destAddress);
  }

  // Fallback: if no address match but we have a confirmed token transfer with value,
  // the token was sent to one of our active deposit addresses — find it.
  if (!intent && payload.state === 'confirmed') {
    const payloadValue = Number(payload.baseValue ?? payload.value ?? 0);
    if (payloadValue > 0) {
      console.log(`[webhook] No direct address match, searching active intents for ${payloadValue} ${payload.coin}...`);
      const activeIntents = await getActiveIntents();
      intent = activeIntents.find(
        (i) => {
          // Match coin: both "hterc6dp" and "hteth:hterc6dp" should match "hteth:hterc6dp"
          const intentCoin = i.coin;
          const payloadCoin = payload.coin as string;
          const coinMatch =
            intentCoin === payloadCoin ||
            intentCoin.endsWith(':' + payloadCoin) ||
            payloadCoin.endsWith(':' + intentCoin.split(':').pop()!);
          // Match amount: payload value is in base units (6 decimals for USDC)
          const amountMatch = Math.abs(i.usdcAmount - (payloadValue / 1_000_000)) < 0.01;
          return coinMatch && amountMatch;
        }
      ) ?? null;
      if (intent) {
        console.log(`[webhook] Found matching intent ${intent.receiptId} by coin/amount`);
      }
    }
  }

  if (!intent) {
    return { ok: true, message: `No intent for address ${destAddress || 'unknown'}` };
  }

  // Idempotency: don't re-process a completed intent.
  if (intent.status === 'COMPLETED' || intent.status === 'CONFIRMED') {
    return { ok: true, message: `Intent ${intent.receiptId} already ${intent.status}` };
  }

  const state: string = transfer?.state ?? payload.state ?? '';
  const txHash: string | null = transfer?.txid ?? payload.hash ?? null;

  // ── Tx mined but not yet fully confirmed ──
  if (state && state !== 'confirmed') {
    await setStatus(intent.receiptId, 'CONFIRMING', {
      detectedTxHash: txHash ?? intent.detectedTxHash,
    });
    return { ok: true, message: `Intent ${intent.receiptId} → CONFIRMING` };
  }

  // ── Confirmed: verify amount + compliance, then finalize ──
  return finalizeConfirmedDeposit(intent, transfer, txHash, payload);
};

const finalizeConfirmedDeposit = async (
  intent: DepositIntentRecord,
  transfer: any,
  txHash: string | null,
  payload?: BitGoTransferEvent
): Promise<{ ok: boolean; message: string }> => {
  // Skip zero-value transfers (address initialization events, fee payments, etc.).
  const receivedBaseUnits =
    transfer?.tokenValue ??
    transfer?.value ??
    transfer?.valueString ??
    transfer?.entries?.find((e: any) => e.value > 0 && !e.wallet)?.value ??
    // Fallback to payload values when transfer fetch failed
    payload?.baseValue ??
    payload?.value ??
    payload?.valueString ??
    null;

  // If the transfer has no value at all, it's an address creation or admin event — ignore it.
  const hasValue = receivedBaseUnits !== null && receivedBaseUnits !== undefined && Number(receivedBaseUnits) > 0;
  if (!hasValue) {
    console.log(`[webhook] transfer ${transfer?.id} has zero value — skipping (address creation or admin event)`);
    return { ok: true, message: 'Skipped zero-value transfer' };
  }

  let receivedAmount: number;
  if (receivedBaseUnits !== null && receivedBaseUnits !== undefined) {
    receivedAmount = toUsdc(receivedBaseUnits);
  } else {
    console.warn(
      `[webhook] Could not extract received amount for intent ${intent.receiptId}. ` +
      `Transfer object: ${JSON.stringify(transfer)}. Defaulting to expected amount.`
    );
    // If we can't determine the received amount but the webhook fired, assume it's correct
    // (BitGo wouldn't fire the webhook if the deposit was invalid)
    receivedAmount = intent.usdcAmount;
  }
  const sourceAddress: string | null =
    transfer?.entries?.find((e: any) => e.value < 0)?.address ??
    transfer?.inputs?.[0]?.address ??
    intent.sourceAddress ??
    null;

  // Compliance screening of the funding source (replaces Chainalysis).
  const compliance = await screenAddress(sourceAddress);

  // Amount check — allow exact or greater; reject underpayment.
  const underpaid = receivedAmount + 1e-9 < intent.usdcAmount;

  // Determine whether to block based on compliance strictness level.
  const shouldBlock = (): boolean => {
    if (!config.complianceEnforced) return false;
    switch (config.complianceStrictness) {
      case 'lenient':
        return compliance.status === 'FAIL';
      case 'moderate':
        return compliance.status === 'FAIL' || compliance.status === 'REVIEW';
      case 'strict':
        return compliance.status !== 'PASS'; // blocks FAIL, REVIEW, and UNKNOWN
    }
  };

  if (shouldBlock()) {
    const reason = compliance.status === 'REVIEW'
      ? 'REVIEW — held for manual inspection'
      : compliance.status === 'UNKNOWN'
      ? 'UNKNOWN — screening could not complete'
      : 'FAIL — sanctioned or blocked by BitGo';
    await setStatus(intent.receiptId, 'FAILED', {
      confirmedTxHash: txHash,
      receivedAmount,
      sourceAddress,
      compliance,
      confirmedAt: Date.now(),
    });
    console.log(`[webhook] Intent ${intent.receiptId} FAILED compliance: ${reason}`);
    return { ok: true, message: `Intent ${intent.receiptId} FAILED compliance (${reason})` };
  }

  if (underpaid) {
    await setStatus(intent.receiptId, 'FAILED', {
      confirmedTxHash: txHash,
      receivedAmount,
      sourceAddress,
      compliance,
      confirmedAt: Date.now(),
    });
    return {
      ok: true,
      message: `Intent ${intent.receiptId} underpaid (${receivedAmount}/${intent.usdcAmount})`,
    };
  }

  // Confirmed and verified → mark CONFIRMED, then COMPLETED (chips issued).
  const now = Date.now();
  await updateIntent(intent.receiptId, {
    status: 'COMPLETED',
    confirmedTxHash: txHash,
    receivedAmount,
    sourceAddress,
    compliance,
    confirmedAt: now,
    completedAt: now,
  });
  return { ok: true, message: `Intent ${intent.receiptId} → COMPLETED (${receivedAmount} USDC)` };
};

/**
 * Register (idempotently) the BitGo wallet webhook that points back at our
 * Cloud Function. Safe to call on deploy or from an admin script.
 */
export const ensureWalletWebhook = async (callbackUrl: string): Promise<void> => {
  console.log('[webhook] Getting wallet...');
  const wallet = await getWallet();
  console.log('[webhook] Wallet retrieved:', wallet.id());
  const anyWallet = wallet as any;
  if (typeof anyWallet.addWebhook !== 'function') {
    throw new Error('Wallet webhook API unavailable in this SDK version');
  }
  console.log('[webhook] addWebhook method exists, registering webhook...');
  await anyWallet.addWebhook({
    url: callbackUrl,
    type: 'transfer',
    numConfirmations: config.network.confirmations,
  });
  console.log(`[webhook] Successfully registered webhook at ${callbackUrl}`);
  console.log('[webhook] Webhook registration complete');
  try {
    await getBitGo();
  } catch {
  }
};