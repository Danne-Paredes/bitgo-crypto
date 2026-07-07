/**
 * Centralized backend configuration.
 *
 * All BitGo-specific settings are read from environment variables so the same
 * code path works for the Firebase emulator, CI, and production deploys.
 *
 * For local development create a `functions/.env` file (see `.env.example`).
 * For production set values with `firebase functions:config:set` or the
 * Cloud Functions environment configuration.
 */

const num = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  // ── BitGo ──
  bitgo: {
    /** BitGo API access token (v2x...). */
    accessToken: process.env.BITGO_ACCESS_TOKEN ?? '',
    /** 'test' → app.bitgo-test.com, 'prod' → app.bitgo.com */
    env: (process.env.BITGO_ENV ?? 'test') as 'test' | 'prod',
    /** Go Account / custodial wallet id that owns the deposit forwarders. */
    walletId: process.env.BITGO_WALLET_ID ?? '',
    /** KSI enterprise id. */
    enterpriseId: process.env.BITGO_ENTERPRISE_ID ?? '',
    /** Shared secret used to verify inbound webhook signatures. */
    webhookSecret: process.env.BITGO_WEBHOOK_SECRET ?? '',
    /** Optional local BitGo Express signing server. */
    expressUrl: process.env.BITGO_EXPRESS_URL ?? '',
    /**
     * Coin ticker for the deposit asset (BitGo statics naming).
     *   - USDC on Ethereum Holesky testnet → 'hteth:tusdc' (token on hteth)
     *   - USDC on Ethereum mainnet         → 'eth:usdcv'   (Circle native USDC)
     * The base coin ('hteth' / 'eth') is derived automatically.
     */
    coin: process.env.BITGO_COIN ?? 'hterc6dp',
  },

  // ── Network / mempool monitoring ──
  network: {
    /**
     * WebSocket RPC endpoint used by the mempool monitor to watch pending
     * transactions in real time (Alchemy / Infura websocket URL).
     */
    wsRpcUrl: process.env.ETH_WS_RPC_URL ?? '',
    /** HTTP RPC endpoint (fallback / receipt lookups). */
    httpRpcUrl: process.env.ETH_HTTP_RPC_URL ?? '',
    /** ERC-20 USDC token contract address on the target network. */
    usdcTokenAddress: process.env.USDC_TOKEN_ADDRESS ?? '',
    /** Number of confirmations BitGo waits before firing the confirmed webhook. */
    confirmations: num(process.env.DEPOSIT_CONFIRMATIONS, 1),
  },

  // ── Cashier business rules ──
  cashier: {
    /** Chips issued per 1 USDC. */
    chipsPerUsdc: num(process.env.CHIPS_PER_USDC, 1),
    /** Deposit intent time-to-live in minutes. */
    intentTtlMinutes: num(process.env.INTENT_TTL_MINUTES, 30),
    /** Minimum acceptable deposit (USDC). */
    minDepositUsdc: num(process.env.MIN_DEPOSIT_USDC, 1),
    /** Maximum acceptable deposit (USDC). */
    maxDepositUsdc: num(process.env.MAX_DEPOSIT_USDC, 100000),
  },

  /** Whether compliance screening must pass before issuing chips. */
  complianceEnforced: (process.env.COMPLIANCE_ENFORCED ?? 'true') === 'true',
};

/** Derive the base coin ('hteth' | 'eth') from a possibly token-qualified coin. */
export const getBaseCoin = (coin: string): string => coin.split(':')[0];

/** True when the minimum BitGo settings required to talk to the API are present. */
export const isBitGoConfigured = (): boolean =>
  Boolean(config.bitgo.accessToken && config.bitgo.walletId);

export type AppConfig = typeof config;
