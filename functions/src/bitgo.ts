/**
 * BitGo REST API integration (no SDK — direct HTTPS calls).
 *
 * Responsibilities:
 *   1. Generate a unique forwarder deposit address per intent.
 *   2. Run BitGo's built-in AML / sanctions screening on a counterparty
 *      address (replacement for Chainalysis).
 *
 * All operations use the BitGo v2 REST API directly — no SDK dependency,
 * no crypto modules, no secp256k1, near-instant cold starts.
 *
 * Network: USDC on Ethereum. Testnet uses the Holesky base coin `hteth`
 * (token `hteth:tusdc`); mainnet uses `eth` / `eth:usdcv`.
 */
import { config, getBaseCoin, isBitGoConfigured } from './config.js';
import type { ComplianceResult } from './types.js';

// ── helpers ──

const bitgoHost = config.bitgo.env === 'test'
  ? 'app.bitgo-test.com'
  : 'app.bitgo.com';

const apiUrl = (path: string): string =>
  `https://${bitgoHost}/api/v2${path}`;

const apiHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${config.bitgo.accessToken}`,
});

const apiGet = async (path: string): Promise<any> => {
  const res = await fetch(apiUrl(path), { headers: apiHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BitGo API ${res.status}: ${body}`);
  }
  return res.json();
};

const apiPost = async (path: string, body: unknown): Promise<any> => {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BitGo API ${res.status}: ${text}`);
  }
  return res.json();
};

// ── public API ──

export interface GeneratedAddress {
  address: string;
  addressId: string | null;
}

/**
 * Generate a brand new forwarder deposit address via REST API.
 * POST /api/v2/{coin}/wallet/{walletId}/address
 */
export const createDepositAddress = async (
  receiptId: string
): Promise<GeneratedAddress> => {
  if (!isBitGoConfigured()) {
    throw new Error('BitGo is not configured. Set BITGO_ACCESS_TOKEN and BITGO_WALLET_ID.');
  }

  const baseCoin = getBaseCoin(config.bitgo.coin);
  const path = `/${baseCoin}/wallet/${config.bitgo.walletId}/address`;

  console.log(`[bitgo] REST POST ${apiUrl(path)}`);
  const result: any = await apiPost(path, {
    label: `deposit-${receiptId}`,
  });

  const address: string = result?.address ?? result?.addressInfo?.address;
  if (!address) {
    throw new Error('BitGo did not return a deposit address');
  }
  console.log(`[bitgo] address created: ${address}`);
  return { address, addressId: result?.id ?? null };
};

/**
 * Screen a counterparty (source) address using BitGo's compliance tooling
 * via REST API.
 */
export const screenAddress = async (
  sourceAddress: string | null
): Promise<ComplianceResult> => {
  const base: ComplianceResult = {
    status: 'UNKNOWN',
    risk: null,
    sourceAddress,
    raw: null,
    error: null,
  };

  if (!sourceAddress) {
    return { ...base, error: 'No source address available to screen' };
  }
  if (!isBitGoConfigured()) {
    return { ...base, error: 'BitGo not configured' };
  }

  try {
    const baseCoin = getBaseCoin(config.bitgo.coin);

    // Try wallet-level address screening first.
    let res: any;
    try {
      res = await apiGet(
        `/${baseCoin}/wallet/${config.bitgo.walletId}/address/${sourceAddress}`
      );
    } catch {
      // Fallback to enterprise compliance screening.
      res = await apiPost('/compliance/screen', {
        address: sourceAddress,
        coin: baseCoin,
      });
    }

    const risk: string | null =
      res?.risk ?? res?.riskLevel ?? res?.result?.risk ?? null;
    const blocked: boolean =
      res?.blocked === true ||
      res?.sanctioned === true ||
      res?.result === 'fail' ||
      res?.status === 'rejected';

    if (blocked) return { ...base, status: 'FAIL', risk: risk ?? 'high', raw: res };

    const normalized = (risk ?? '').toString().toLowerCase();
    if (normalized === 'high' || normalized === 'severe') {
      return { ...base, status: 'REVIEW', risk, raw: res };
    }
    if (normalized === 'low' || normalized === 'none' || res?.passed === true) {
      return { ...base, status: 'PASS', risk: risk ?? 'low', raw: res };
    }
    return { ...base, status: 'PASS', risk, raw: res };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'Screening request failed' };
  }
};

// Keep back-compat exports for callers that still import these (webhook.ts uses getWallet).
// These are now stubs — webhook is the only remaining SDK-dependent module.
export const getBitGo = async (): Promise<any> => {
  throw new Error('getBitGo is deprecated — use REST API directly');
};

export const getWallet = async (): Promise<any> => {
  throw new Error('getWallet is deprecated — use REST API directly');
};
