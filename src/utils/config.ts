/**
 * Frontend configuration for the BitGo deposit-address flow.
 *
 * The frontend no longer talks to the chain directly (no ethers / no
 * WalletConnect / no smart-contract addresses). It only needs:
 *   - the cashier backend base URL (Cloud Functions)
 *   - display metadata (chip rate, explorer, network label)
 *   - polling cadence for the deposit state machine
 */
export const getConfig = () => ({
  // Network display metadata
  chainName: (import.meta.env.VITE_CHAIN_NAME as string) || 'Ethereum Holesky',
  blockExplorerUrl:
    (import.meta.env.VITE_BLOCK_EXPLORER_URL as string) || 'https://holesky.etherscan.io',

  // Chip exchange
  chipsPerUsdc: parseFloat(import.meta.env.VITE_CHIPS_PER_USDC as string) || 1,

  // Asset label shown in the UI (e.g. 'USDC')
  assetSymbol: (import.meta.env.VITE_ASSET_SYMBOL as string) || 'USDC',

  // Backend API (Firebase Cloud Functions)
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL as string,

  // How often (ms) the UI polls the backend for deposit status updates
  statusPollIntervalMs:
    parseInt(import.meta.env.VITE_STATUS_POLL_INTERVAL_MS as string) || 4000,
})

export const formatUsdc = (amount: number): string => amount.toFixed(2)
