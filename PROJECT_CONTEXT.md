# Casino Crypto Payment System - Project Context

## Business Objective

We operate casinos and want to accept cryptocurrency (USDC on Ethereum) from players in exchange for casino chips. Players send USDC → we give them equivalent value in chips for use in our casinos.

**Current Focus**: USDC on Ethereum only (may expand to other coins later)  
**No fiat conversion needed**: Just tracking crypto value and issuing chips 1:1 (less fees eventually)

---

## The Migration: From Smart Contracts to BitGo

### What We Had Before
Our original implementation used:
- **Custom Smart Contract** (`CasinoCashier.sol`) - handled USDC transfers on-chain
- **WalletConnect** - for players to connect their wallets and sign transactions
- **Chainalysis** - for AML/sanctions screening of player wallets
- **Player-Push Model** - players signed 2 transactions: `approve()` + `depositFor()`

**Problems with the old approach**:
- Players needed to pay gas fees
- Complex UX (connect wallet, approve, deposit)
- Smart contract maintenance and security risks
- Required players to have self-custodial wallets

### What We're Moving To: BitGo
BitGo is an institutional cryptocurrency custody and wallet infrastructure provider. They offered us a **single omnibus account** model that simplifies everything.

**Why BitGo**:
- ✅ **One-stop shop**: Handles custody, transactions, compliance, and wallet management
- ✅ **Better UX**: Players just send USDC to an address (works from any wallet/exchange)
- ✅ **No gas fees for players**: They just send USDC
- ✅ **Built-in compliance**: AML/sanctions screening included
- ✅ **Institutional security**: Enterprise-grade custody
- ✅ **API-driven**: Easy integration with our existing system

---

## What BitGo Provides

### 1. **Wallet Custody & Management**
- **Go Account (Omnibus Model)**: A single institutional wallet under our company (KSI)
- **Forwarder Addresses**: Generate unique deposit addresses for each transaction
- **Auto-Consolidation**: Funds sent to deposit addresses automatically sweep to our main treasury

### 2. **Transaction Infrastructure**
- **Address Generation API**: Create unique addresses on-demand
- **Transaction Webhooks**: Get notified when deposits are confirmed
- **Multi-coin Support**: Can handle Bitcoin, Ethereum, USDC, and 200+ assets

### 3. **Compliance & Security**
- **Built-in AML/Sanctions Screening**: Replaces our Chainalysis integration
- **Risk Assessment**: PASS/REVIEW/FAIL verdicts on addresses
- **Enterprise Security**: Multi-sig, MPC, role-based access

### 4. **Developer Tools**
- **Free Testnet/Sandbox**: `app.bitgo-test.com` for testing
- **SDKs**: Official Node.js SDK (`@bitgo/sdk-api`)
- **Comprehensive APIs**: RESTful APIs for all operations

---

## New Architecture Overview

```
┌─────────────┐
│   Cashier   │ (React frontend)
│  Terminal   │
└──────┬──────┘
       │
       ├─ POST /cashier/deposit-intent ─┐
       ├─ GET /cashier/intent/:id (poll) │
       │                                 │
       ▼                                 ▼
┌──────────────────────────────────────────┐
│  Firebase Cloud Functions (Backend)      │
│  ├─ BitGo SDK Integration                │
│  ├─ Firestore (deposit_intents DB)       │
│  ├─ Address Generation                   │
│  └─ Webhook Handler                      │
└──────┬───────────────────┬───────────────┘
       │                   │
       │                   ▼
       │            ┌─────────────┐
       │            │   BitGo     │
       │            │ Go Account  │
       │            │  (Omnibus)  │
       │            └─────────────┘
       │
       ▼
┌─────────────────────┐
│  Mempool Monitor    │ (Standalone worker)
│  (Real-time TX      │
│   Detection)        │
└─────────────────────┘
```

### Key Components

1. **Frontend (React + Vite)**
   - Cashier enters chip amount
   - Displays QR code with unique deposit address
   - Polls backend for status updates
   - Shows real-time progress: Awaiting → Detected → Confirming → Confirmed

2. **Backend (Firebase Cloud Functions)**
   - `/deposit-intent`: Generate new BitGo forwarder address
   - `/intent/:id`: Status polling endpoint
   - `/webhook`: Receive BitGo confirmation webhooks
   - Firestore database for tracking deposit intents

3. **BitGo Integration**
   - SDK: `@bitgo/sdk-api` + `@bitgo/sdk-coin-eth`
   - Generates unique addresses per deposit
   - Auto-consolidates to treasury wallet
   - Provides compliance screening
   - Sends webhooks on confirmed deposits

4. **Mempool Monitor (Critical for UX)**
   - Standalone Node.js service
   - Connects via WebSocket to Ethereum RPC
   - Detects transactions in real-time (before confirmation)
   - Updates Firestore when player broadcasts transaction
   - **Eliminates the "blind spot"** - cashier sees "Detected" immediately instead of waiting 5+ minutes for confirmations

---

## Deposit Flow (Step-by-Step)

1. **Cashier initiates**: Enters chip amount (e.g., 100 chips = $100 USDC)

2. **Backend generates address**:
   - Calls `BitGo.createDepositAddress(receiptId)`
   - Returns unique USDC deposit address
   - Saves `DepositIntentRecord` in Firestore (status: `AWAITING`)

3. **Frontend displays**:
   - Shows QR code with deposit address
   - Shows countdown timer (15 min expiry)
   - Starts polling backend every 4 seconds

4. **Player sends USDC**:
   - Scans QR or copies address
   - Sends USDC from their wallet/exchange
   - No wallet connection needed, no gas fees to us

5. **Mempool Monitor detects** (seconds later):
   - Sees pending transaction in mempool
   - Updates Firestore: `AWAITING` → `DETECTED`
   - Frontend immediately shows "Transaction Detected!"

6. **Transaction confirms** (1-5 minutes):
   - Mempool Monitor sees confirmed log: `DETECTED` → `CONFIRMING`
   - BitGo webhook fires: full confirmation
   - Backend updates: `CONFIRMING` → `CONFIRMED`

7. **Compliance & finalization**:
   - Backend screens source address via BitGo
   - Checks if amount matches expected
   - If all good: `CONFIRMED` → `COMPLETED`
   - If failed: `CONFIRMED` → `FAILED`

8. **Cashier issues chips**:
   - Frontend shows success screen
   - Cashier gives player physical/digital chips

---

## Deposit State Machine

```
AWAITING          (Waiting for player to send USDC)
    ↓
DETECTED          (TX seen in mempool - instant feedback!)
    ↓
CONFIRMING        (TX mined but not fully confirmed)
    ↓
CONFIRMED         (BitGo webhook: fully confirmed)
    ↓
COMPLETED         (Compliance passed, chips can be issued)

Terminal states:
- EXPIRED         (15 min timer ran out)
- FAILED          (Compliance failed or underpaid)
```

---

## Key Technical Details

### BitGo Configuration
- **Environment**: Testnet (`app.bitgo-test.com`) → Production (`app.bitgo.com`)
- **Coin Ticker**:
  - Testnet: `hteth:tusdc` (Hoodi Testnet USDC)
  - Mainnet: `eth:usdcv` (Ethereum Mainnet USDC)
- **Go Account**: Single omnibus wallet for all deposits
- **Forwarder Addresses**: Unique per transaction, auto-consolidate to main wallet
- **Webhook**: Requires HMAC-SHA256 signature verification for security

### Environment Variables

**Backend (`functions/.env`)**:
```bash
# BitGo
BITGO_ACCESS_TOKEN=<your_api_token>
BITGO_ENV=test                           # or 'prod'
BITGO_WALLET_ID=<go_wallet_id>
BITGO_ENTERPRISE_ID=<enterprise_id>
BITGO_WEBHOOK_SECRET=<webhook_secret>
BITGO_COIN=hterc6dp                      # Hoodi testnet ERC-20 (6 decimals, like USDC)

# Ethereum RPC (for mempool monitor)
ETH_WS_RPC_URL=wss://ethereum-hoodi-rpc.publicnode.com
ETH_HTTP_RPC_URL=https://ethereum-hoodi-rpc.publicnode.com
USDC_TOKEN_ADDRESS=0x76c57d19bd3529dadf4bb66e75f0808bc8264a5e  # hterc6dp contract
DEPOSIT_CONFIRMATIONS=1                  # confirmations needed

# Business Rules
CHIPS_PER_USDC=1
INTENT_TTL_MINUTES=15
MIN_DEPOSIT_USDC=10
MAX_DEPOSIT_USDC=100000
COMPLIANCE_ENFORCED=true
```

**Frontend (`.env`)**:
```bash
VITE_CHAIN_NAME=Ethereum Hoodi
VITE_BLOCK_EXPLORER_URL=https://hoodi.etherscan.io
VITE_ASSET_SYMBOL=USDC
VITE_CHIPS_PER_USDC=1
VITE_STATUS_POLL_INTERVAL_MS=4000
VITE_API_BASE_URL=https://us-central1-<project>.cloudfunctions.net/cashier
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check, BitGo config status |
| `/cashier/deposit-intent` | POST | Generate new deposit address |
| `/cashier/intent/:receiptId` | GET | Poll deposit status |
| `/cashier/intent/:receiptId` | PATCH | Update intent status (cashier actions) |
| `/cashier/webhook` | POST | BitGo webhook for confirmed deposits |

### Database Schema (Firestore)

**Collection**: `deposit_intents`

```typescript
{
  receiptId: string;           // Unique ID (e.g., "rcpt_a1b2c3...")
  playerRef: string;           // Player reference (e.g., "plyr_x9y8z7...")
  status: DepositStatus;       // AWAITING | DETECTED | CONFIRMING | CONFIRMED | COMPLETED | EXPIRED | FAILED
  usdcAmount: number;          // Expected USDC amount
  chipAmount: number;          // Equivalent chip amount
  depositAddress: string;      // BitGo forwarder address
  bitgoAddressId: string;      // BitGo's internal address ID
  createdByEmail: string;      // Cashier who created it
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;        // TTL for auto-expiry
  
  // Populated as deposit progresses
  detectedTxHash?: string;     // TX hash when first seen in mempool
  detectedAt?: Timestamp;
  confirmedTxHash?: string;    // Final confirmed TX hash
  confirmedAt?: Timestamp;
  receivedAmount?: number;     // Actual USDC received
  sourceAddress?: string;      // Player's sending address
  compliance?: ComplianceResult; // BitGo screening result
  completedAt?: Timestamp;
}
```

---

## What Was Replaced

| Old Component | New Component | Why |
|--------------|---------------|-----|
| Custom Smart Contract | BitGo Go Account | No contract maintenance, better security |
| WalletConnect | Simple address display | Better UX, works with any wallet |
| Chainalysis API | BitGo Compliance | Built-in, one less integration |
| ethers.js (frontend) | BitGo SDK (backend) | All blockchain logic server-side |
| 2-step TX (approve + deposit) | 1-step TX (simple send) | Simpler for players |

---

## What Was Preserved

- ✅ Firebase Authentication (cashier login)
- ✅ Firestore database (transaction records)
- ✅ Firebase Hosting (frontend deployment)
- ✅ React + TypeScript + Vite (frontend stack)
- ✅ Tailwind CSS (styling)
- ✅ Cashier terminal UX (input amount → show QR → track status)
- ✅ Domain restrictions (`knighted.com`, `knightedvegas.com`)

---

## Current Implementation Status

### ✅ Completed
- Backend Firebase Cloud Functions with BitGo SDK integration
- Deposit intent creation endpoint
- Status polling endpoint
- BitGo webhook handler with HMAC verification
- Mempool monitor for real-time transaction detection
- Frontend refactored to address-per-deposit flow
- QR code display for deposit addresses
- Real-time status updates (AWAITING → DETECTED → CONFIRMING → CONFIRMED → COMPLETED)
- Compliance screening integration
- Firestore database schema and helpers
- Environment configuration for testnet and mainnet

### 🧪 Testing Phase
- Testnet integration testing needed
- BitGo sandbox account setup
- Mempool monitor deployment and testing
- End-to-end deposit flow verification

### 📋 Next Steps
1. **BitGo Testnet Setup**:
   - Sign up at `app.bitgo-test.com`
   - Create Go Account wallet
   - Get Wallet ID and API token
   - Share wallet ID with BitGo to fund with testnet USDC
   - Register webhook endpoint

2. **Configure Environment**:
   - Add BitGo credentials to `functions/.env`
   - Update frontend `.env` with testnet block explorer

3. **Deploy & Test**:
   - Deploy Cloud Functions to Firebase
   - Run mempool monitor (Cloud Run or VM)
   - Test full deposit flow on Hoodi testnet

4. **Production Migration**:
   - Repeat setup on mainnet BitGo
   - Update environment variables
   - Feature flag rollout (test on one terminal first)
   - Full casino floor deployment

---

## Important Notes for AI IDE

1. **BitGo SDK quirks**:
   - Coin tickers are network-specific: `hteth:tusdc` (testnet), `eth:usdcv` (mainnet)
   - Must register `Eth`, `Hteth`, `Erc20Token` constructors manually
   - Use `createTokenConstructors()` for ERC-20 tokens

2. **Mempool Monitor**:
   - MUST run as long-lived process (not Cloud Function)
   - Requires WebSocket RPC connection (not HTTP-only)
   - Entry point: `functions/src/mempool-service.ts`
   - Run via: `npm run mempool` in functions directory

3. **Webhook Security**:
   - Always verify HMAC-SHA256 signature
   - Use raw body buffer (not parsed JSON)
   - Secret must match BitGo webhook configuration

4. **Compliance**:
   - BitGo returns structured screening results
   - `COMPLIANCE_ENFORCED` flag controls blocking behavior
   - Store raw screening data for audit trail

5. **Address Management**:
   - Each deposit gets unique forwarder address
   - Addresses auto-consolidate to main wallet (BitGo feature)
   - Index addresses in Firestore for fast lookup

6. **Status Transitions**:
   - Frontend polls every 4 seconds
   - Mempool monitor provides instant feedback (DETECTED)
   - BitGo webhook provides authoritative confirmation
   - Multiple sources update same Firestore document

---

## Key Files Reference

**Backend**:
- `functions/src/index.ts` - Cloud Functions entry point, API routes
- `functions/src/bitgo.ts` - BitGo SDK wrapper, address generation, compliance
- `functions/src/webhook.ts` - BitGo webhook handler
- `functions/src/mempool.ts` - Mempool monitor class
- `functions/src/mempool-service.ts` - Mempool monitor entry point
- `functions/src/firestore.ts` - Database helpers
- `functions/src/types.ts` - TypeScript interfaces
- `functions/src/config.ts` - Environment config

**Frontend**:
- `src/pages/Home.tsx` - Main cashier UI component
- `src/utils/api.ts` - Backend API client
- `src/utils/config.ts` - Frontend config
- `src/types/index.ts` - Frontend TypeScript types

**Config**:
- `functions/.env` - Backend environment variables
- `.env` - Frontend environment variables
- `firebase.json` - Firebase project configuration

**Documentation**:
- `README.md` - Setup and architecture docs
- `/home/ubuntu/designs/bitgo_integration_design.md` - Original design document
- `/home/ubuntu/current_implementation_analysis.md` - Analysis of old implementation

---

## Questions to Consider

1. **Do you want to test on Hoodi testnet first or jump to mainnet?**
2. **Where will the mempool monitor run?** (Cloud Run, dedicated VM, or local for testing)
3. **Webhook URL**: What domain will host the Cloud Functions? (Needed for BitGo webhook registration)
4. **Compliance strictness**: Should `COMPLIANCE_ENFORCED=true` block all non-PASS results?
5. **Deposit limits**: Confirm min/max USDC amounts ($10-$100k currently)

---

## Contact & Resources

- **BitGo Docs**: https://developers.bitgo.com
- **BitGo Testnet**: https://app.bitgo-test.com
- **BitGo Production**: https://app.bitgo.com
- **Ethereum Hoodi Explorer**: https://hoodi.etherscan.io
- **Firebase Console**: https://console.firebase.google.com

---

*This document provides complete context for understanding the casino crypto payment system migration from smart contracts to BitGo. Use this as reference when making changes or troubleshooting.*
