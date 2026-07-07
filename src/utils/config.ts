import { ethers } from 'ethers'

export const getConfig = () => ({
  // Network
  rpcUrl: (import.meta.env.VITE_RPC_URL as string) || '',
  chainId: parseInt((import.meta.env.VITE_CHAIN_ID as string) || '0'),
  chainName: (import.meta.env.VITE_CHAIN_NAME as string) || 'Ethereum Hoodi',
  blockExplorerUrl:
    (import.meta.env.VITE_BLOCK_EXPLORER_URL as string) || 'https://hoodi.etherscan.io',
  blockConfirmations: parseInt((import.meta.env.VITE_BLOCK_CONFIRMATIONS as string) || '1'),

  // ERC-20 token
  usdcTokenAddress: (import.meta.env.VITE_USDC_TOKEN_ADDRESS as string) || '',

  // Chip exchange
  chipsPerUsdc: parseFloat((import.meta.env.VITE_CHIPS_PER_USDC as string) || '1'),

  // Asset label
  assetSymbol: (import.meta.env.VITE_ASSET_SYMBOL as string) || 'USDC',

  // WalletConnect
  walletConnectProjectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string) || '',

  // Backend API
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string) || '',
})

export const getProvider = () => {
  const config = getConfig()
  return new ethers.JsonRpcProvider(config.rpcUrl)
}

export { formatUsdc, parseUsdc } from './usdc'
