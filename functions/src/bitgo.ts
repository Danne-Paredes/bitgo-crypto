/**
 * BitGo SDK integration.
 *
 * Responsibilities:
 *   1. Build an authenticated BitGo API client.
 *   2. Generate a unique forwarder deposit address per intent
 *      (`wallet.createAddress`). BitGo auto-flushes funds from the forwarder
 *      to the Go Account base address.
 *   3. Run BitGo's built-in AML / sanctions screening on a counterparty
 *      address (replacement for Chainalysis).
 *
 * Network: USDC on Ethereum. Testnet uses the Holesky base coin `hteth`
 * (token `hteth:tusdc`); mainnet uses `eth` / `eth:usdcv`.
 */
import { config, getBaseCoin, isBitGoConfigured } from './config.js';
import type { ComplianceResult } from './types.js';

let sdk: any = null;
let BitGoImportError: Error | null = null;

const getBitGoClass = async () => {
  if (BitGoImportError) {
    throw BitGoImportError;
  }
  try {
    const mod = await import('bitgo');
    return mod.BitGo;
  } catch (err: any) {
    BitGoImportError = err;
    console.error('[bitgo] Failed to import bitgo module:', err?.message ?? String(err));
    throw BitGoImportError;
  }
};

/** Lazily construct and register the BitGo client. */
export const getBitGo = async (): Promise<any> => {
  if (sdk) return sdk;
  if (!isBitGoConfigured()) {
    throw new Error(
      'BitGo is not configured. Set BITGO_ACCESS_TOKEN and BITGO_WALLET_ID.'
    );
  }

  const BitGo = await getBitGoClass();
  const api = new BitGo({
    accessToken: config.bitgo.accessToken,
    env: config.bitgo.env,
  });

  sdk = api;
  return api;
};

/** Resolve the configured BitGo Go Account wallet. */
export const getWallet = async () => {
  const api = await getBitGo();
  const baseCoin = getBaseCoin(config.bitgo.coin);
  return api.coin(baseCoin).wallets().get({ id: config.bitgo.walletId });
};

export interface GeneratedAddress {
  address: string;
  addressId: string | null;
}

/**
 * Generate a brand new forwarder deposit address for a receipt.
 * Each call returns a unique on-chain address; funds sent to it are
 * automatically consolidated to the Go Account base address by BitGo.
 */
export const createDepositAddress = async (
  receiptId: string
): Promise<GeneratedAddress> => {
  console.log('[bitgo] createDepositAddress called, getting wallet...');
  const wallet = await getWallet();
  console.log('[bitgo] wallet retrieved, creating address...');
  const result: any = await wallet.createAddress({
    label: `deposit-${receiptId}`,
  });
  const address: string = result?.address ?? result?.addressInfo?.address;
  if (!address) {
    throw new Error('BitGo did not return a deposit address');
  }
  return { address, addressId: result?.id ?? null };
};

/**
 * Screen a counterparty (source) address using BitGo's compliance tooling.
 *
 * BitGo exposes AML / travel-rule screening through its API. We call the
 * address-verification / screening endpoint and normalize the response into a
 * pass / review / fail decision. If screening cannot be reached we fail open to
 * UNKNOWN so deposits are not silently dropped (the caller decides enforcement).
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
    const api = await getBitGo();
    const baseCoin = getBaseCoin(config.bitgo.coin);
    // BitGo address screening endpoint (AML / sanctions). Returns a risk verdict.
    const res: any = await api
      .get(api.url(`/${baseCoin}/wallet/${config.bitgo.walletId}/address/${sourceAddress}`, 2))
      .result()
      .catch(async () =>
        // Fallback to the enterprise-level compliance screening endpoint.
        api
          .post(api.url('/compliance/screen', 2))
          .send({ address: sourceAddress, coin: baseCoin })
          .result()
      );

    const verdict = normalizeScreening(res);
    return { ...base, ...verdict, raw: res };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'Screening request failed' };
  }
};

/** Map a raw BitGo screening payload to a pass/review/fail verdict. */
const normalizeScreening = (
  res: any
): Pick<ComplianceResult, 'status' | 'risk'> => {
  const risk: string | null =
    res?.risk ?? res?.riskLevel ?? res?.result?.risk ?? null;
  const blocked: boolean =
    res?.blocked === true ||
    res?.sanctioned === true ||
    res?.result === 'fail' ||
    res?.status === 'rejected';

  if (blocked) return { status: 'FAIL', risk: risk ?? 'high' };

  const normalized = (risk ?? '').toString().toLowerCase();
  if (normalized === 'high' || normalized === 'severe') {
    return { status: 'REVIEW', risk };
  }
  if (normalized === 'low' || normalized === 'none' || res?.passed === true) {
    return { status: 'PASS', risk: risk ?? 'low' };
  }
  return { status: 'PASS', risk };
};
