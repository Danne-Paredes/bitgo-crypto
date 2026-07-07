# AGENT OPERATING RULES

## Scope Discipline
- Work only on what the user explicitly asks.
- Do not add extra features, refactors, cleanup, dependency updates, or architectural changes unless requested.
- If an action is potentially out of scope, stop and ask for approval first.

## Confirmation Before Extra Work
- Ask before doing anything not directly required to complete the request.
- When in doubt about relevance, ask a clarifying question instead of assuming.

## Change Boundaries
- Keep changes minimal and targeted to the requested outcome.
- Avoid touching unrelated files.
- Avoid broad repository-wide actions unless they are necessary for the ask.

## Execution Behavior
- Briefly state the next intended action before making changes.
- If additional improvements are identified, present them as optional follow-ups and wait for approval.
- Prioritize completing the requested task end-to-end before proposing extras.

---

## Current Status (July 6, 2026)

### ✅ Working — Deposit Flow End-to-End

The full crypto deposit pipeline is functional:

1. **Cashier creates deposit intent** → BitGo address generated via REST API → QR code displayed
2. **Player sends USDC/hterc6dp** → webhook fires from BitGo
3. **Webhook processed** → signature verified → intent matched by coin + amount → status advanced to COMPLETED
4. **UI polls** every 4s → picks up status change → shows "Deposit Confirmed"

### ✅ Key Fixes Applied This Session

- **Cloud Function structure fixed**: Export name `cashier` (not `depositIntent`), routes stripped of `/cashier` prefix to avoid double-path URLs
- **firebase.json predeploy hook**: `tsc` build runs automatically before deploy — no more stale compiled code
- **`.env` VITE_API_BASE_URL**: Fixed to include `/cashier` suffix
- **Webhook HMAC verification**: Signature header is `x-signature-sha256` (not `BitGo-Signature`)
- **Coin matching in webhook**: Fuzzy match handles `hterc6dp` ↔ `hteth:hterc6dp` differences
- **Zero-value transfer guard**: Address initialization events (value=0) are skipped
- **Webhook registered with `allToken: true`**: Now receives ERC-20 token transfer events
- **REST API for address creation**: `functions/src/bitgo.ts` replaced SDK with direct REST calls — no more `secp256k1` cold start (48s → <1s)

### ⚠️ Ongoing / Known Issues

- **Webhook speed**: Token transfer webhook takes ~1-2 min after deposit. Can't control — depends on BitGo + blockchain confirmation time.
- **Compliance screen error**: Shows in UI occasionally (screenAddress API call). Cosmetic — doesn't block deposits. May need to revisit the compliance endpoint.
- **Mempool monitor not running**: `mempool-service.ts` exists but isn't deployed. Running it would provide instant "DETECTED" status via WebSocket.
- **Frontend `.env` local dev URL**: Currently points to production. Need to document `http://localhost:5001/kv-crypto-app/us-central1/cashier` for emulator use.

---

## Architecture Reference

### Files That Matter

| File | Role |
|------|------|
| `functions/src/index.ts` | Express app — routes, function exports |
| `functions/src/bitgo.ts` | REST API calls to BitGo (no SDK) |
| `functions/src/webhook.ts` | Webhook handler + HMAC verification |
| `functions/src/firestore.ts` | Firestore CRUD for deposit intents |
| `functions/src/config.ts` | Environment config |
| `functions/register-webhook.mjs` | Admin script to register BitGo webhook |
| `src/pages/Home.tsx` | Cashier UI |
| `src/utils/api.ts` | Frontend API client |
| `src/utils/config.ts` | Frontend config (env vars) |
| `firebase.json` | Firebase project config + predeploy hooks |

### Environment Variables

**Backend (`functions/.env`)**:
```
BITGO_ACCESS_TOKEN=v2x...
BITGO_ENV=test
BITGO_WALLET_ID=6a42a902...
BITGO_ENTERPRISE_ID=6a3d59...
BITGO_WEBHOOK_SECRET=whb607e7...
BITGO_COIN=hteth:hterc6dp
ETH_WS_RPC_URL=wss://...
ETH_HTTP_RPC_URL=https://...
USDC_TOKEN_ADDRESS=0x76c5...
DEPOSIT_CONFIRMATIONS=1
```

**Frontend (`.env`)**:
```
VITE_API_BASE_URL=https://us-central1-kv-crypto-app.cloudfunctions.net/cashier
VITE_CHAIN_NAME=Ethereum Hoodi
VITE_BLOCK_EXPLORER_URL=https://hoodi.etherscan.io
```

### Deploy Commands

```bash
# Build + deploy cloud functions
cd functions && npm run build && cd .. && firebase deploy --only functions

# Register/re-register webhook
cd functions && node register-webhook.mjs https://us-central1-kv-crypto-app.cloudfunctions.net/cashier/webhook
```

---

## Resolved Issues (Archive)

### Session 1 — UI Stuck on QR Code
✅ Webhook was never registered. Fixed in later sessions.

### Session 2 — Webhook Registration
✅ REST API script created. Was hitting wrong hostname (`testnet.bitgo.com` → fixed to `app.bitgo-test.com`).

### Session 3 — Cloud Functions Deployment Fix
✅ Container healthcheck failure from `bitgo` SDK ESM/CJS conflict. Fixed with deferred import. Later superseded by REST API migration (no more SDK dependency).

### Session 4 — QR Code 403 Authentication Error
✅ Fixed with `cors: true` + `invoker: "public"` on function config.

### Session 4 Continuation — Function Naming
✅ Export renamed `depositIntent` → back to `cashier` after realizing the codebase prefix already handles namespacing.

### Webhook Verification Failure
✅ Header name was `x-signature-sha256`, not `BitGo-Signature`. Fixed.

### Token Transfer Matching
✅ Coin `hterc6dp` in webhook payload didn't match `hteth:hterc6dp` in intents. Fixed with fuzzy matching.

### Address Creation Performance
✅ Replaced BitGo SDK with direct REST API calls. Cold start went from ~48s to sub-second.
