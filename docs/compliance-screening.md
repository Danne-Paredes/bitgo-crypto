# BitGo Compliance Screening

## Overview

When a player sends USDC to a BitGo deposit address, BitGo automatically runs compliance screening on the sender's wallet address. This screening checks against:

- **OFAC sanctions lists** — wallets owned by sanctioned individuals or entities
- **Known illicit wallets** — darknet markets, mixers, ransomware operators, stolen funds
- **High-risk entities** — exchanges with poor KYC, fraud shops, scam operations

The webhook fires **after** BitGo completes this screening and settles the deposit. Our backend then runs an additional screening pass via BitGo's API (`screenAddress`) and applies our own policy before deciding whether to issue chips.

---

## How the Screening Works

### Step-by-Step

```
1. Player sends USDC → BitGo forwarder address
2. BitGo receives deposit, runs internal AML/sanctions check
3. BitGo fires webhook with state: "confirmed"
4. Our webhook handler extracts the sender's address
5. Our handler calls BitGo's screenAddress API for a second opinion
6. Our handler applies compliance strictness policy
7. PASS → chips issued | FAIL/REVIEW/UNKNOWN → depends on strictness level
```

### What BitGo Returns

| Field | Values | Meaning |
|---|---|---|
| `risk` | `low`, `medium`, `high`, `severe` | BitGo's risk assessment |
| `blocked` | `true` / `false` | Explicitly blocked (sanctioned) |
| `sanctioned` | `true` / `false` | On an OFAC or equivalent sanctions list |

### How We Map It

Our `screenAddress` function in `bitgo.ts` converts BitGo's response into one of four statuses:

| Our Status | BitGo Condition | Meaning |
|---|---|---|
| **PASS** | `risk: "low"`, `risk: "none"`, or `passed: true` | Clean wallet, no concerns |
| **REVIEW** | `risk: "high"` or `risk: "severe"` but **not** explicitly blocked | Flagged but not banned — may have interacted with mixers, high-risk exchanges, etc. |
| **FAIL** | `blocked: true`, `sanctioned: true`, `result: "fail"` | Explicitly blocked — sanctioned entity, known illicit wallet |
| **UNKNOWN** | API call failed / no source address available | Screening couldn't complete — treated based on strictness level |

---

## Compliance Strictness Levels

Each casino location can have its own strictness level, set via the `COMPLIANCE_STRICTNESS` environment variable on the Cloud Function.

### `lenient` (Default)

**Blocks:** FAIL only  
**Allows:** PASS, REVIEW, UNKNOWN

REVIEW wallets pass through and chips are issued normally. The compliance panel shows "REVIEW" for audit purposes but doesn't block the transaction.

**Best for:** High-volume locations where you want maximum flow and are willing to accept some risk from flagged-but-not-banned wallets.

**Example:** A player who interacted with a mixer 6 months ago has `risk: "high"` but isn't sanctioned. With lenient, their deposit completes and chips are issued. The REVIEW flag is logged for compliance audit.

---

### `moderate`

**Blocks:** FAIL, REVIEW  
**Allows:** PASS, UNKNOWN

REVIEW wallets are blocked and held for manual inspection. The deposit is marked FAILED in Firestore but the funds are still in BitGo custody. An operator can manually review and override.

**Best for:** Most locations — balanced approach. Keeps out flagged wallets while not over-blocking on API issues.

**Example:** Same mixer-interacting player. With moderate, their deposit is blocked and the intent shows `FAILED` with `compliance.status: "REVIEW"`. A compliance officer reviews the case and can manually complete it if acceptable.

---

### `strict`

**Blocks:** FAIL, REVIEW, UNKNOWN  
**Allows:** PASS only

Only wallets that receive a clean PASS get chips. If the screening API fails (UNKNOWN), the deposit is blocked rather than allowed through. Safest but may block valid deposits during BitGo API outages.

**Best for:** High-risk jurisdictions, VIP handling, or locations with regulatory requirements demanding zero tolerance.

**Example:** A completely clean wallet sends a deposit but BitGo's screen API returns a 500 error. With strict, this deposit is blocked — not because the wallet is bad, but because we couldn't verify it's clean. With lenient or moderate, it would go through.

---

## Per-Location Configuration

Since each casino location has its own BitGo wallet (different `BITGO_WALLET_ID`), the compliance settings are **wallet-specific**, not global. Here's how multi-location setup works:

### Architecture

```
Location A (Las Vegas)     Location B (International)    Location C (High-Risk)
├── BITGO_WALLET_ID: aaa   ├── BITGO_WALLET_ID: bbb      ├── BITGO_WALLET_ID: ccc
├── COMPLIANCE_STRICTNESS: ├── COMPLIANCE_STRICTNESS:    ├── COMPLIANCE_STRICTNESS:
│   lenient                │   moderate                  │   strict
└── COMPLIANCE_ENFORCED:   └── COMPLIANCE_ENFORCED:      └── COMPLIANCE_ENFORCED:
    true                       true                          true
```

### How to Set It Up

Each location deploys its own Cloud Function instance (or we use the same function with different env vars per deployment). The `COMPLIANCE_STRICTNESS` and `COMPLIANCE_ENFORCED` env vars are set per deployment:

**Location A (lenient):**
```bash
firebase deploy --only functions:cashier
# .env contains:
# COMPLIANCE_STRICTNESS=lenient
```

**Location B (moderate):**
```bash
firebase deploy --only functions:cashier-location-b
# .env contains:
# COMPLIANCE_STRICTNESS=moderate
```

### Alternative: Runtime Wallet Lookup

If all locations share a single Cloud Function deployment, strictness could be determined at runtime by looking up the wallet ID:

```typescript
// Future enhancement — not yet implemented:
const walletConfig = await getWalletConfig(config.bitgo.walletId);
const strictness = walletConfig.complianceStrictness ?? 'lenient';
```

This lets you change strictness per wallet without redeploying. For now, per-deployment env vars achieve the same thing.

---

## Manual Override Process

When a deposit is blocked at `moderate` or `strict` level (REVIEW or UNKNOWN), a compliance officer can:

1. **Review the intent** in Firestore — see `compliance.risk`, `compliance.sourceAddress`, and `compliance.raw`
2. **Check the sender address** on a block explorer or external screening tool
3. **Manually complete or reject** via the PATCH endpoint:
   ```bash
   curl -X PATCH https://...cloudfunctions.net/cashier/intent/RECEIPT_ID \
     -H 'Content-Type: application/json' \
     -d '{"status": "COMPLETED", "txHash": "0x..."}'
   ```
4. **Document the override** in Firestore or an audit log

---

## Scenario Reference

### Clean Wallet → Always Passes
```
Sender: 0xabcd... (regular retail wallet)
BitGo: risk "low", blocked false
Our status: PASS
All levels: chips issued ✅
```

### Mixer Interaction → Depends on Strictness
```
Sender: 0x1234... (interacted with Tornado Cash 3 months ago)
BitGo: risk "high", blocked false
Our status: REVIEW
Lenient: chips issued ✅
Moderate: blocked ❌ (manual review available)
Strict: blocked ❌
```

### Sanctioned Wallet → Always Blocked
```
Sender: 0xdead... (OFAC SDN listed)
BitGo: risk "severe", blocked true, sanctioned true
Our status: FAIL
All levels: blocked ❌
```

### API Outage → Depends on Strictness
```
Sender: 0xbeef... (any wallet)
BitGo screen API: HTTP 500
Our status: UNKNOWN (error: "Screening request failed")
Lenient: chips issued ✅
Moderate: chips issued ✅
Strict: blocked ❌
```

---

## Environment Variables Reference

| Variable | Values | Default | Effect |
|---|---|---|---|
| `COMPLIANCE_ENFORCED` | `true` / `false` | `true` | Master switch — `false` disables all blocking |
| `COMPLIANCE_STRICTNESS` | `lenient` / `moderate` / `strict` | `lenient` | Which compliance outcomes block chips |

---

## Audit Trail

Every deposit intent in Firestore records the full compliance result:

```json
{
  "compliance": {
    "status": "REVIEW",
    "risk": "high",
    "sourceAddress": "0x1234...",
    "raw": { "risk": "high", "blocked": false, ... },
    "error": null
  }
}
```

This gives a complete audit trail for every deposit — what was screened, what the result was, and what action was taken.
