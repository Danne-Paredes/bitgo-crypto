/**
 * Deposit status lifecycle for the BitGo address-per-deposit model.
 *
 *   AWAITING  → deposit address generated, QR shown to the player
 *   DETECTED  → tx seen in the mempool (real-time, pre-block) by the monitor
 *   CONFIRMING→ tx mined, waiting for confirmations
 *   CONFIRMED → BitGo confirmed webhook received, amount verified
 *   COMPLETED → chips issued (terminal, success)
 *   EXPIRED   → intent TTL elapsed with no funds (terminal)
 *   FAILED    → screening failed / amount mismatch / error (terminal)
 */
export type DepositStatus =
  | 'AWAITING'
  | 'DETECTED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'FAILED'

export type ComplianceStatus = 'PASS' | 'REVIEW' | 'FAIL' | 'UNKNOWN'

export interface ComplianceResult {
  status: ComplianceStatus
  risk: string | null
  sourceAddress: string | null
  raw: unknown | null
  error: string | null
}

/**
 * A BitGo deposit intent. Replaces the old smart-contract DepositIntent
 * (no playerRef/contract calldata needed — funds go to a unique address).
 */
export interface DepositIntent {
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

  // Populated as the deposit progresses (from status polling)
  receivedAmount?: number | null
  detectedTxHash?: string | null
  confirmedTxHash?: string | null
  compliance?: ComplianceResult | null
}
