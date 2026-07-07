# WalletConnect vs BitGo-Only: Deposit Flow Comparison

## Overview

The casino cashier app lets customers exchange cash for chips by sending USDC. We're currently using **BitGo custody** to generate deposit addresses and settle funds. This document compares two approaches for the customer-facing deposit experience.

---

## How They Work

### BitGo-Only (Current)

```
Cashier enters amount → BitGo generates deposit address → 
QR code shown (just the address) → Player manually sends USDC →
Polling waits ~45-60s → BitGo webhook confirms → Done
```

- The QR code is just the deposit address encoded as an image
- Player must: open their wallet, paste the address, select the correct token (USDC on Hoodi), enter the exact amount, confirm
- No real-time feedback — the UI stays on "waiting" for 45-60 seconds until BitGo's webhook fires
- Player can make mistakes (wrong token, wrong amount, wrong network)

### WalletConnect + BitGo (Proposed)

```
Cashier enters amount → BitGo generates deposit address →
WalletConnect QR shown → Player scans with MetaMask →
App shows review screen with pre-filled amount → Player clicks "Confirm" →
App sends the USDC transfer → Real-time progress feedback → Done
```

- The QR code connects the player's wallet **to our app**, not just to an address
- Player only has to: scan once, click confirm
- Token, amount, and destination are all pre-filled by our app — no manual entry
- Real-time feedback: "Sending..." → "Transaction submitted" → "Confirmed" — all within seconds
- BitGo webhook still fires later as authoritative settlement confirmation

---

## Side-by-Side Comparison

| | BitGo-Only | WalletConnect + BitGo |
|---|---|---|
| **Player actions** | 5 steps (scan, select token, enter amount, confirm, wait) | 2 steps (scan, confirm) |
| **Mistake-proof** | No — player can send wrong token/amount | Yes — app controls the transaction |
| **Real-time feedback** | No — 45-60s blind wait | Yes — instant progress updates |
| **Infrastructure** | Cloud Functions + BitGo API | Same + WalletConnect (free) |
| **Monthly cost** | $0 | $0 (WalletConnect free tier) |
| **Backend changes** | None | 1 line changed (allow DETECTED status) |
| **Frontend work** | None | ~1 day (port existing WalletConnect code from smart_contract_web_app) |
| **Custody** | BitGo (same) | BitGo (same) |
| **Settlement** | BitGo webhook | BitGo webhook (same) |
| **Compliance** | BitGo AML screen | BitGo AML screen (same) |

---

## Third Path Considered: Mempool Monitor (BitGo-Only + Real-Time Status)

We also explored a middle-ground approach: keep the current BitGo-only deposit flow but add a **mempool monitor** to provide real-time status updates. Here's how it works and why we chose WalletConnect instead.

### How the Mempool Monitor Works

```
Cashier enters amount → BitGo generates deposit address →
QR code shown (just the address) → Player manually sends USDC →
Mempool monitor detects pending transaction (~3-5s) → UI shows "DETECTED" →
Mempool monitor sees mined block (~15s) → UI shows "CONFIRMING" →
BitGo webhook fires (~45-60s) → UI shows "COMPLETED"
```

The mempool monitor is a **long-lived background worker** that watches the Ethereum mempool via WebSocket. Every time a new pending transaction appears, it checks if it's a USDC transfer to one of our active deposit addresses. If so, it updates Firestore to `DETECTED`, and the UI picks it up on the next poll.

### Why It Requires Cloud Run (Extra Infrastructure)

The mempool monitor **cannot run on Cloud Functions** because:

- Cloud Functions are **request-response only** — they spin up when called, handle one request, then spin down
- The mempool monitor needs a **persistent WebSocket connection** to the Ethereum node — it must stay alive 24/7 to catch transactions the moment they're broadcast
- Cloud Functions have a **60-second timeout** — the monitor runs indefinitely

The solution is **Cloud Run**: GCP's long-lived container service. A single always-on instance watches the mempool, reads Firestore for active intents, and writes status updates. This adds:

| Cost Item | Estimate |
|---|---|
| Cloud Run (1 instance, 256MiB, always-on) | ~$14–18/month |
| Maintenance | Another service to monitor, deploy, and debug |
| Cold-start risk | If the instance crashes, mempool monitoring stops until it restarts |

### Why We Chose WalletConnect Instead

The mempool monitor **only solves the status visibility problem** — it tells the UI a transaction was detected, but the player still has to:

- Copy the deposit address from our QR code
- Select the correct token in their wallet
- Enter the exact amount manually
- Confirm and wait

Every one of those steps is an opportunity for error. WalletConnect solves **all of them at once** — the transaction is constructed by our app, the player just confirms, and we get real-time status for free because the browser itself is watching the transaction on-chain.

In other words: the mempool monitor adds $15/month and a new service to maintain, but only fixes the 50-second blind wait. It doesn't fix the manual entry UX problem. WalletConnect fixes both, costs nothing, and requires no new infrastructure.

| | Mempool Monitor | WalletConnect |
|---|---|---|
| **Real-time status** | ✅ Yes (via polling) | ✅ Yes (browser-native) |
| **Mistake-proof** | ❌ No | ✅ App controls the tx |
| **Infrastructure** | Cloud Run (~$15/mo) | None (free) |
| **Player experience** | Same manual flow, just with progress bar | One scan, one click |

---

## Why We Can't Just Use BitGo for This

BitGo is a **custody platform**, not a payment UX provider. Their QR code feature simply encodes the wallet's receive address as a QR image. They don't offer:

- A way to connect a customer's wallet to our app
- Pre-filled transaction construction
- Real-time blockchain event streaming to the browser

This isn't a limitation of BitGo — it's just not what they do. Their API handles address generation, custody, compliance screening, and settlement webhooks. WalletConnect handles the missing piece: the customer-facing payment experience.

---

## Cost Analysis

| | BitGo-Only | WalletConnect + BitGo |
|---|---|---|
| **WalletConnect** | N/A | Free (1 project, unlimited connections) |
| **BitGo custody** | Same | Same |
| **Cloud Functions** | Same | Same |
| **Additional infra** | Cloud Run ~$15/mo (if we add mempool monitor for real-time feedback) | None |
| **Total monthly** | $15 (with mempool) or $0 (blind UX) | $0 |

WalletConnect's free tier supports one project with unlimited connections. All our casino locations would share the same WalletConnect project ID. If we later need separate projects per location, the Cloud plan is ~$150/mo.

---

## What Stays the Same

- **BitGo custody** — funds still flow through BitGo's institutional wallet
- **BitGo webhook** — still the authoritative settlement confirmation
- **Compliance screening** — BitGo's AML/sanctions screen still runs
- **Firestore** — same deposit_intents collection
- **Backend API** — same endpoints (1 minor change: accepting DETECTED status)

### A Note on the Webhook: The Source of Truth

Regardless of which approach we use, **the BitGo webhook is always the final authority** on whether a deposit has settled. Here's why:

- The browser shows "Confirmed" when the blockchain confirms the USDC transfer, but this is **best-effort feedback** — it tells the player their transaction was mined, not that BitGo has credited the casino's wallet
- **BitGo's internal ledger** is what matters for custody. The blockchain may show a transfer as confirmed, but BitGo still needs to process it through their own settlement pipeline
- The webhook fires only after **BitGo's settlement is complete** — this is the point where chips should actually be issued
- The webhook also triggers **compliance screening** (BitGo's AML/sanctions check on the sender's address), which can't run until BitGo has processed the transfer

In practice: the WalletConnect flow gives the player real-time progress ("Transaction submitted... Confirmed on-chain"), but the final "Chips Issued" status only appears after the BitGo webhook fires. This is a feature, not a bug — it ensures chips are never issued before funds are fully settled and screened.

---

## Timeline

| Phase | Work | Time |
|---|---|---|
| 1. Backend | Allow DETECTED status in PATCH handler | ✅ Done |
| 2. Frontend | Install WalletConnect + ethers deps | 5 min |
| 3. Frontend | Add USDC transfer utility | 10 min |
| 4. Frontend | Update config for WalletConnect | 5 min |
| 5. Frontend | Rewrite Home.tsx with new flow | 1-2 hours |
| 6. Testing | End-to-end test on Hoodi testnet | 30 min |
| **Total** | | **~1 day** |

---

## Recommendation

WalletConnect + BitGo gives us the best of both:
- **BitGo's institutional custody** for secure fund handling
- **WalletConnect's payment UX** for a smooth customer experience
- **Zero additional infrastructure cost**

This is the same architecture used by the smart_contract_web_app (already working), adapted to use BitGo addresses instead of smart contract calls.
