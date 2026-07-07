/**
 * Shared backend types for the BitGo deposit lifecycle.
 *
 * The deposit state machine intentionally mirrors the frontend
 * (`src/types/index.ts`) so the two stay in lock-step:
 *
 *   AWAITING  → address generated, QR shown to the player
 *   DETECTED  → tx seen in the mempool (real-time, pre-block) by the monitor
 *   CONFIRMING→ tx mined, waiting for `confirmations` blocks
 *   CONFIRMED → BitGo confirmed webhook received, amount verified
 *   COMPLETED → cashier issued chips (terminal, success)
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
  | 'FAILED';

export type ComplianceStatus = 'PASS' | 'REVIEW' | 'FAIL' | 'UNKNOWN';

export interface ComplianceResult {
  status: ComplianceStatus;
  /** Free-form risk label surfaced by BitGo screening (e.g. 'low', 'high'). */
  risk: string | null;
  /** Source address that was screened, when known. */
  sourceAddress: string | null;
  /** Raw screening payload for audit. */
  raw: unknown | null;
  /** Populated when screening itself failed to run. */
  error: string | null;
}

export interface DepositIntentRecord {
  /** Firestore document id == receiptId. */
  receiptId: string;
  /** Opaque player reference issued by the cashier. */
  playerRef: string;
  /** Unique BitGo forwarder address funds should be sent to. */
  depositAddress: string;
  /** BitGo address id (for label / lookup). */
  bitgoAddressId: string | null;
  /** Coin ticker, e.g. 'hteth:usdc'. */
  coin: string;
  /** Expected deposit amount in USDC (human units). */
  usdcAmount: number;
  /** Chips to be issued on confirmation. */
  chipsAmount: number;
  chipsPerUsdc: number;
  status: DepositStatus;
  /** Cashier operator email (from Firebase Auth ACL). */
  createdByEmail: string | null;

  // ── On-chain tracking ──
  detectedTxHash: string | null;
  confirmedTxHash: string | null;
  /** Actual amount received (USDC human units) once known. */
  receivedAmount: number | null;
  sourceAddress: string | null;

  // ── Compliance ──
  compliance: ComplianceResult | null;

  // ── Timestamps (epoch ms) ──
  createdAt: number;
  expiresAt: number;
  detectedAt: number | null;
  confirmedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

/** Public shape returned to the frontend when an intent is created. */
export interface DepositIntentResponse {
  receiptId: string;
  playerRef: string;
  depositAddress: string;
  coin: string;
  usdcAmount: number;
  chipsAmount: number;
  chipsPerUsdc: number;
  status: DepositStatus;
  createdAt: number;
  expiresAt: number;
}

/** Public shape returned by the status-polling endpoint. */
export interface DepositStatusResponse {
  receiptId: string;
  status: DepositStatus;
  depositAddress: string;
  usdcAmount: number;
  chipsAmount: number;
  receivedAmount: number | null;
  detectedTxHash: string | null;
  confirmedTxHash: string | null;
  compliance: ComplianceResult | null;
  expiresAt: number;
  detectedAt: number | null;
  confirmedAt: number | null;
  completedAt: number | null;
}
