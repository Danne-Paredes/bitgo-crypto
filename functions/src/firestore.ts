/**
 * Firestore access layer for deposit intents.
 *
 * Collection: `deposit_intents` (keyed by receiptId)
 *   - replaces the old smart-contract "intent" records
 *   - drives the cashier UI and reconciliation
 */
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DepositIntentRecord, DepositStatus } from './types.js';

// Initialize the Admin SDK exactly once (safe across function cold starts).
if (getApps().length === 0) {
  try {
    initializeApp();
  } catch {
    // Fallback for environments that need explicit ADC.
    initializeApp({ credential: applicationDefault() });
  }
}

export const db = getFirestore();

const COLLECTION = 'deposit_intents';
const ADDRESS_INDEX = 'deposit_address_index';

export const intentsCol = () => db.collection(COLLECTION);

export const createIntent = async (record: DepositIntentRecord): Promise<void> => {
  await intentsCol().doc(record.receiptId).set(record);
  // Maintain a reverse index (address → receiptId) so the mempool monitor and
  // webhook handler can resolve an intent from an on-chain address quickly.
  await db.collection(ADDRESS_INDEX).doc(record.depositAddress.toLowerCase()).set({
    receiptId: record.receiptId,
    createdAt: record.createdAt,
  });
};

export const getIntent = async (
  receiptId: string
): Promise<DepositIntentRecord | null> => {
  const snap = await intentsCol().doc(receiptId).get();
  return snap.exists ? (snap.data() as DepositIntentRecord) : null;
};

export const getIntentByAddress = async (
  address: string
): Promise<DepositIntentRecord | null> => {
  const idx = await db.collection(ADDRESS_INDEX).doc(address.toLowerCase()).get();
  if (idx.exists) {
    const { receiptId } = idx.data() as { receiptId: string };
    return getIntent(receiptId);
  }
  // Fallback: direct query (covers index gaps).
  const q = await intentsCol().where('depositAddress', '==', address).limit(1).get();
  return q.empty ? null : (q.docs[0].data() as DepositIntentRecord);
};

export const updateIntent = async (
  receiptId: string,
  patch: Partial<DepositIntentRecord>
): Promise<void> => {
  await intentsCol()
    .doc(receiptId)
    .set({ ...patch, updatedAt: Date.now() }, { merge: true });
};

export const setStatus = async (
  receiptId: string,
  status: DepositStatus,
  extra: Partial<DepositIntentRecord> = {}
): Promise<void> => {
  await updateIntent(receiptId, { status, ...extra });
};

/** Active intents the mempool monitor should be watching. */
export const getActiveIntents = async (): Promise<DepositIntentRecord[]> => {
  const now = Date.now();
  const snap = await intentsCol()
    .where('status', 'in', ['AWAITING', 'DETECTED', 'CONFIRMING'])
    .get();
  return snap.docs
    .map((d) => d.data() as DepositIntentRecord)
    .filter((r) => r.expiresAt > now);
};

/** Expire stale AWAITING intents whose TTL has passed. */
export const expireStaleIntents = async (): Promise<number> => {
  const now = Date.now();
  const snap = await intentsCol()
    .where('status', '==', 'AWAITING')
    .where('expiresAt', '<', now)
    .get();
  const batch = db.batch();
  snap.docs.forEach((d) =>
    batch.set(d.ref, { status: 'EXPIRED', updatedAt: now }, { merge: true })
  );
  if (!snap.empty) await batch.commit();
  return snap.size;
};

export { FieldValue };
