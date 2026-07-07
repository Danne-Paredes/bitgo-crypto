import { ethers } from 'ethers'

const requireAddress = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !ethers.isAddress(value)) {
    throw new Error(`Invalid ${label} address`)
  }
  return value
}

export const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

export const getUsdcContract = (
  contractAddress: string,
  signerOrProvider: ethers.Signer | ethers.Provider
) => new ethers.Contract(
  requireAddress(contractAddress, 'USDC contract'),
  USDC_ABI,
  signerOrProvider
)

export const getUsdcBalance = async (
  contractAddress: string,
  walletAddress: string,
  provider: ethers.Provider
): Promise<bigint> => {
  const contract = getUsdcContract(contractAddress, provider)
  return await contract.balanceOf(requireAddress(walletAddress, 'wallet'))
}

/** Send USDC to a recipient address. Returns the transaction response. */
export const transferUsdc = async (
  contractAddress: string,
  signer: ethers.Signer,
  to: string,
  amount: bigint
): Promise<ethers.ContractTransactionResponse> => {
  const contract = getUsdcContract(contractAddress, signer)
  return await contract.transfer(requireAddress(to, 'recipient'), amount)
}

export const formatUsdc = (amount: bigint): string =>
  ethers.formatUnits(amount, 6)

export const parseUsdc = (amount: string): bigint =>
  ethers.parseUnits(amount, 6)
