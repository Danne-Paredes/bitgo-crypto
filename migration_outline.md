Here’s the migration outline to rebuild smart_contract_web_app cleanly for CasinoCashier (Sepolia + USDC approve + depositFor):

1) Network and config layer
Set chain to Ethereum Sepolia.
Add env vars:
VITE_SEPOLIA_CHAIN_ID=11155111
VITE_SEPOLIA_RPC_URL=...
VITE_USDC_ADDRESS=...
VITE_CASHIER_ADDRESS=...
Keep Firebase auth as-is.
2) Contract integration
Add CasinoCashier ABI with at least:
depositFor(address player, uint256 amount, bytes32 playerRef, bytes32 receiptId)
DepositReceived(...) event
Keep ERC20 ABI for approve, allowance, decimals.
3) Payment flow (core change)
Replace old direct transfer flow with:

User enters amount.
Convert amount to token units (decimals).
Check allowance (allowance(user, cashier)).
If insufficient, send approve(cashier, amount) and wait confirm.
Send depositFor(player, amount, playerRef, receiptId) and wait confirm.
Show tx hash + success state.
4) Backend/API requirement
Add endpoint to mint server-trusted refs before tx:

POST /cashier/deposit-intent
Returns:
playerRef (bytes32)
receiptId (bytes32, unique/idempotent)
player wallet
amount
Store intent + status for reconciliation.
5) Confirmation and receipts
Primary: parse tx receipt logs for DepositReceived.
Secondary: backend indexer/webhook reconciliation for reliability.
Persist: wallet, amount, playerRef, receiptId, approveTx?, depositTx, status, timestamp.
6) QR strategy update
Do not use plain wallet-address QR anymore. Use QR for:

a hosted payment-intent URL (recommended), or
WalletConnect/deeplink containing intent ID. Then app fetches intent and executes approve+depositFor flow.
7) Suggested implementation order
Config + ABIs
Wallet/network guards (Sepolia only)
Deposit intent API
Frontend approve + depositFor
Receipt/event handling
QR intent flow
Error UX + retries + idempotency
8) Minimal acceptance criteria
User on Sepolia can complete approve+depositFor end-to-end.
Duplicate receiptId rejected/idempotent.
UI shows pending/success/fail per tx stage.
Receipt persisted and queryable by receiptId.
If you want, next I can provide an exact file-by-file scaffold for smart_contract_web_app (components, hooks, utils, API routes) in execution order.