import { getConfig } from './config'
import type { ComplianceResult, DepositStatus } from '../types'

export interface DepositIntentResponse {
  receiptId: string
  playerRef: string
  depositAddress: string
  coin: string
  usdcAmount: number
  chipsAmount: number
  chipsPerUsdc: number
  status: DepositStatus
  createdAt: number
  expiresAt: number
}

export interface DepositStatusResponse {
  receiptId: string
  status: DepositStatus
  depositAddress: string
  usdcAmount: number
  chipsAmount: number
  receivedAmount: number | null
  detectedTxHash: string | null
  confirmedTxHash: string | null
  compliance: ComplianceResult | null
  expiresAt: number
  detectedAt: number | null
  confirmedAt: number | null
  completedAt: number | null
}

/** Raised when compliance screening blocks a deposit. */
export class WalletBlockedError extends Error {
  public readonly compliance: ComplianceResult | null
  constructor(message: string, compliance: ComplianceResult | null) {
    super(message)
    this.name = 'WalletBlockedError'
    this.compliance = compliance
  }
}

/**
 * Create a deposit intent. The backend generates a unique BitGo forwarder
 * address and returns it for display as a QR code / copyable address.
 */
export const createDepositIntent = async (
  amount: string | number,
  opts?: { playerRef?: string; createdByEmail?: string }
): Promise<DepositIntentResponse> => {
  const config = getConfig()
  const response = await fetch(`${config.apiBaseUrl}/deposit-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, ...opts }),
  })

  if (response.status === 403) {
    const err = await response.json().catch(() => ({ error: 'Blocked by compliance' }))
    throw new WalletBlockedError(err.error ?? 'Blocked by compliance', err.compliance ?? null)
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Network error' }))
    throw new Error(err.error || `API error: ${response.status}`)
  }
  return response.json()
}

/**
 * Poll the current status of a deposit intent. Drives the
 * Awaiting → Detected → Confirming → Confirmed/Completed UI.
 */
export const getIntentStatus = async (
  receiptId: string
): Promise<DepositStatusResponse> => {
  const config = getConfig()
  const response = await fetch(
    `${config.apiBaseUrl}/intent/${receiptId}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Network error' }))
    throw new Error(err.error || `API error: ${response.status}`)
  }
  return response.json()
}

/** Cashier-side status transition (cancel / manual complete). */
export const updateIntentStatus = async (
  receiptId: string,
  status: DepositStatus
): Promise<void> => {
  const config = getConfig()
  await fetch(`${config.apiBaseUrl}/intent/${receiptId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }).catch(() => {
    console.warn('Failed to update intent status on backend')
  })
}
