# Casino Cashier — Chip Exchange (BitGo + USDC on Ethereum)

A Vite + React + TypeScript web app for exchanging USDC for casino chips using
**BitGo** custody. Instead of smart contracts + WalletConnect, the cashier
generates a **unique BitGo deposit (forwarder) address per transaction**, shows
it to the customer as a QR code, and tracks the deposit in real time.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (Vite + React + TypeScript)                     │
│  Firebase Auth + Firestore ACL                            │
│  Displays deposit address / QR, polls deposit status      │
└───────────────┬───────────────────────────┬──────────────┘
                │ POST /cashier/deposit-intent│ GET /cashier/intent/:id
                ▼                             ▼
┌──────────────────────────────────────────────────────────┐
│  Backend — Firebase Cloud Functions (functions/)          │
│  • BitGo SDK: createAddress (forwarder per deposit)       │
│  • BitGo compliance screening (replaces Chainalysis)      │
│  • Webhook handler (HMAC-verified confirmed deposits)     │
│  • Firestore deposit_intents records                      │
└───────────────┬───────────────────────────┬──────────────┘
                │ createAddress / webhooks    │ DETECTED updates
                ▼                             ▼
┌───────────────────────────┐   ┌──────────────────────────┐
│  BitGo Go Account (custody)│   │  Mempool Monitor (worker) │
│  Auto-forwards to treasury │   │  ethers WS → pending txs  │
└───────────────────────────┘   └──────────────────────────┘
```

## Deposit State Machine

```
AWAITING ──► DETECTED ──► CONFIRMING ──► CONFIRMED/COMPLETED
  (QR shown)  (mempool)    (mined)        (webhook + chips issued)
     │
     └──► EXPIRED (TTL elapsed)      any ──► FAILED (compliance / underpaid)
```

- **AWAITING** — backend generated a BitGo forwarder address; QR shown to customer.
- **DETECTED** — the **mempool monitor** spotted the USDC transfer *before* it was
  mined, eliminating the confirmation "blind spot".
- **CONFIRMING** — transaction mined, waiting for `DEPOSIT_CONFIRMATIONS` blocks.
- **CONFIRMED / COMPLETED** — BitGo's confirmed webhook fired, amount + compliance
  verified, chips issued.

## Deposit Flow

1. **Cashier** enters the chip dollar amount → frontend calls `POST /cashier/deposit-intent`.
2. Backend calls BitGo `wallet.createAddress()` and stores an `AWAITING` intent.
3. Frontend shows the **deposit address + QR code** and begins polling status.
4. **Customer** sends USDC to the address from any wallet/exchange.
5. The **mempool monitor** flips the intent to `DETECTED` the instant the tx is broadcast.
6. BitGo confirms the deposit and POSTs an HMAC-signed webhook → backend verifies the
   amount, runs compliance screening, and marks the intent `COMPLETED`.
7. Frontend polls `COMPLETED` and shows success.

## Setup — Frontend

```bash
cp .env.example .env          # set VITE_API_BASE_URL, chip rate, network labels
npm install
npm run dev
```

## Setup — Backend (Cloud Functions)

```bash
cd functions
cp .env.example .env          # set BitGo + RPC + cashier values
npm install
npm run build
npm run serve                 # Firebase emulator
# or
npm run deploy                # firebase deploy --only functions
```

## Setup — BitGo Webhook Registration

After deploying the Cloud Function, register the webhook with BitGo so it knows where to send confirmed deposits:

```bash
cd functions
npm run build
node register-webhook.mjs https://us-central1-kv-crypto-app.cloudfunctions.net/cashier/webhook
```

Replace the URL with your actual Cloud Function URL. You can find it in Firebase Console → Cloud Functions → cashier → Trigger URL.

**Note:** This step is critical. Without webhook registration, BitGo will not notify your backend when deposits are confirmed, causing the UI to remain stuck on the QR code screen.

## Setup — Mempool Monitor (real-time detection)

The mempool listener must run as a **long-lived worker** (Cloud Functions are
ephemeral and can't hold a websocket open). It shares the same Firestore project.

```bash
cd functions
npm run build
npm run mempool               # node lib/mempool-service.js
```

Requires `ETH_WS_RPC_URL` (Alchemy/Infura websocket) and `USDC_TOKEN_ADDRESS`.

## Environment Variables

### Frontend (`.env`)
| Variable | Description |
|----------|-------------|
| `VITE_CHAIN_NAME` | Display label, e.g. `Ethereum Hoodi` |
| `VITE_BLOCK_EXPLORER_URL` | Explorer base URL for tx links |
| `VITE_ASSET_SYMBOL` | Asset label (default `USDC`) |
| `VITE_CHIPS_PER_USDC` | Chip exchange rate |
| `VITE_STATUS_POLL_INTERVAL_MS` | Status polling cadence (default 4000) |
| `VITE_API_BASE_URL` | Cloud Functions base URL |

### Backend (`functions/.env`)
| Variable | Description |
|----------|-------------|
| `BITGO_ACCESS_TOKEN` | BitGo API token |
| `BITGO_ENV` | `test` or `prod` |
| `BITGO_WALLET_ID` | Go Account / custodial wallet id |
| `BITGO_ENTERPRISE_ID` | KSI enterprise id |
| `BITGO_WEBHOOK_SECRET` | HMAC secret for webhook verification |
| `BITGO_COIN` | `hteth:tusdc` (testnet) / `eth:usdcv` (mainnet) |
| `ETH_WS_RPC_URL` | Websocket RPC for mempool monitor |
| `ETH_HTTP_RPC_URL` | HTTP RPC fallback |
| `USDC_TOKEN_ADDRESS` | USDC ERC-20 contract on the target network |
| `DEPOSIT_CONFIRMATIONS` | Confirmations BitGo waits for |
| `CHIPS_PER_USDC` / `INTENT_TTL_MINUTES` | Cashier business rules |
| `MIN_DEPOSIT_USDC` / `MAX_DEPOSIT_USDC` | Deposit bounds |
| `COMPLIANCE_ENFORCED` | Block deposits that FAIL screening |

## API Endpoints (Cloud Functions)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/cashier/deposit-intent` | Generate BitGo deposit address → returns address + receiptId |
| `GET` | `/cashier/intent/:receiptId` | Poll deposit status (drives the UI state machine) |
| `PATCH` | `/cashier/intent/:receiptId` | Cashier-side transition (cancel / manual complete) |
| `POST` | `/cashier/webhook` | BitGo confirmed-deposit webhook (HMAC-verified) |
| `GET` | `/health` | Health check |

## Compliance

Chainalysis is replaced by **BitGo's built-in AML / sanctions screening**
(`screenAddress` in `functions/src/bitgo.ts`). The funding source address is
screened at confirmation time; a `FAIL` verdict marks the deposit `FAILED` when
`COMPLIANCE_ENFORCED=true`.

## Preserved from the original app

- Firebase Authentication (Google sign-in, domain ACL)
- Firestore `allowed_users` / `super_users` collections
- UI branding, styling, dark leather background, login page
- Cashier terminal UX (amount entry → status tracking → success)
