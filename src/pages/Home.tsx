import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { DepositIntent, DepositStatus, ComplianceResult } from '../types'
import { getConfig } from '../utils/config'
import {
  createDepositIntent,
  getIntentStatus,
  updateIntentStatus,
  WalletBlockedError,
} from '../utils/api'
import { useAuthStore } from '../store/auth-store'

type Step =
  | 'cashier'   // Cashier enters chip amount
  | 'creating'  // Generating BitGo deposit address
  | 'deposit'   // Address/QR shown; polling Awaiting → Detected → Confirming
  | 'done'      // Confirmed / Completed
  | 'error'     // Failed / Expired

const TERMINAL_SUCCESS: DepositStatus[] = ['CONFIRMED', 'COMPLETED']
const TERMINAL_FAILURE: DepositStatus[] = ['FAILED', 'EXPIRED']

export default function Home() {
  const { clearAuth, aclUser } = useAuthStore()
  const [step, setStep] = useState<Step>('cashier')
  const [cashierAmount, setCashierAmount] = useState('')
  const [intent, setIntent] = useState<DepositIntent | null>(null)
  const [status, setStatus] = useState<DepositStatus>('AWAITING')
  const [receivedAmount, setReceivedAmount] = useState<number | null>(null)
  const [detectedTxHash, setDetectedTxHash] = useState<string | null>(null)
  const [confirmedTxHash, setConfirmedTxHash] = useState<string | null>(null)
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null)
  const [showFullAnalysis, setShowFullAnalysis] = useState(false)
  const [error, setError] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [copied, setCopied] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const config = getConfig()
  const explorerUrl = config.blockExplorerUrl

  const clearPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }
  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => () => { clearPolling(); clearTimer() }, [])

  /** Expiry countdown while awaiting a deposit. */
  useEffect(() => {
    if (intent && step === 'deposit') {
      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.floor((intent.expiresAt - Date.now()) / 1000))
        setTimeLeft(remaining)
        if (remaining === 0) clearTimer()
      }, 1000)
    }
    return () => clearTimer()
  }, [intent, step])

  /** Poll backend for deposit status transitions. */
  const startPolling = useCallback((receiptId: string) => {
    clearPolling()

    const poll = async () => {
      try {
        const s = await getIntentStatus(receiptId)
        setStatus(s.status)
        setReceivedAmount(s.receivedAmount)
        setDetectedTxHash(s.detectedTxHash)
        setConfirmedTxHash(s.confirmedTxHash)
        setCompliance(s.compliance)

        if (TERMINAL_SUCCESS.includes(s.status)) {
          clearPolling(); clearTimer()
          setStep('done')
        } else if (TERMINAL_FAILURE.includes(s.status)) {
          clearPolling(); clearTimer()
          setError(
            s.status === 'EXPIRED'
              ? 'Deposit window expired before funds arrived.'
              : s.compliance?.status === 'FAIL'
              ? 'Deposit blocked by compliance screening.'
              : 'Deposit failed. The amount received did not match the order.'
          )
          setStep('error')
        }
      } catch (err: any) {
        console.warn('[polling] status fetch error:', err?.message)
      }
    }

    poll()
    pollRef.current = setInterval(poll, config.statusPollIntervalMs)
  }, [config.statusPollIntervalMs])

  /** Cashier → generate a BitGo deposit address for the entered amount. */
  const generateDepositAddress = async () => {
    const chips = parseFloat(cashierAmount)
    if (!chips || chips <= 0) { setError('Enter a valid chip amount'); return }
    const amount = chips / config.chipsPerUsdc
    setError('')
    setStep('creating')
    setStatusMsg('Generating secure deposit address...')

    try {
      const res = await createDepositIntent(amount, {
        createdByEmail: aclUser?.email,
      })
      const newIntent: DepositIntent = {
        receiptId: res.receiptId,
        playerRef: res.playerRef,
        depositAddress: res.depositAddress,
        coin: res.coin,
        usdcAmount: res.usdcAmount,
        chipsAmount: res.chipsAmount,
        chipsPerUsdc: res.chipsPerUsdc,
        status: res.status,
        createdAt: res.createdAt,
        expiresAt: res.expiresAt,
      }
      setIntent(newIntent)
      setStatus(res.status)
      setTimeLeft(Math.max(0, Math.floor((res.expiresAt - Date.now()) / 1000)))
      setStep('deposit')
      setStatusMsg('')
      startPolling(res.receiptId)
    } catch (e: unknown) {
      if (e instanceof WalletBlockedError) {
        setCompliance(e.compliance)
        setError(e.message)
        setStep('error')
      } else {
        setError(e instanceof Error ? e.message : 'Failed to create deposit address')
        setStep('cashier')
      }
      setStatusMsg('')
    }
  }

  const copyAddress = async () => {
    if (!intent) return
    try {
      await navigator.clipboard.writeText(intent.depositAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard unavailable */ }
  }

  const cancelDeposit = () => {
    if (intent) updateIntentStatus(intent.receiptId, 'EXPIRED').catch(() => {})
    reset()
  }

  const reset = () => {
    clearPolling(); clearTimer()
    setStep('cashier')
    setIntent(null)
    setStatus('AWAITING')
    setReceivedAmount(null)
    setDetectedTxHash(null)
    setConfirmedTxHash(null)
    setCompliance(null)
    setShowFullAnalysis(false)
    setError('')
    setStatusMsg('')
    setCashierAmount('')
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  // ── Step indicator mapping ──
  const stepLabels = ['Address', 'Detected', 'Confirming', 'Complete']
  const statusToIndex: Record<DepositStatus, number> = {
    AWAITING: 0, DETECTED: 1, CONFIRMING: 2,
    CONFIRMED: 3, COMPLETED: 3, FAILED: 0, EXPIRED: 0,
  }
  const activeIndex = step === 'done' ? 3 : statusToIndex[status]
  const isCashierView = step === 'cashier' || step === 'creating'

  const statusCopy: Record<DepositStatus, { title: string; sub: string }> = {
    AWAITING: { title: 'Waiting for Deposit', sub: 'Have the customer send the exact USDC amount to the address below.' },
    DETECTED: { title: 'Deposit Detected', sub: 'Transaction spotted in the mempool — waiting for it to be mined.' },
    CONFIRMING: { title: 'Confirming on-chain', sub: 'Transaction mined. Waiting for network confirmations.' },
    CONFIRMED: { title: 'Deposit Confirmed', sub: 'Funds confirmed by BitGo.' },
    COMPLETED: { title: 'Deposit Confirmed', sub: 'Chips have been issued.' },
    FAILED: { title: 'Deposit Failed', sub: '' },
    EXPIRED: { title: 'Deposit Expired', sub: '' },
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center p-6">
      <div className={`w-full flex flex-col ${isCashierView ? 'max-w-130' : 'max-w-110'}`}>

        {/* Header */}
        <div className="bg-[#1a1a2e] rounded-t-2xl px-8 pt-7 pb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-linear-to-br from-[#c9a84c] to-[#f0d080] flex items-center justify-center font-extrabold text-base text-[#1a1a2e]">K</div>
              <span className="text-[#c9a84c] font-bold text-[15px] tracking-[0.05em]">CRYPTO CO</span>
            </div>
            <p className="text-[#8888aa] text-[13px] m-0">{isCashierView ? 'Cashier Terminal' : 'Chip Exchange'}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="bg-[rgba(201,168,76,0.1)] border border-[rgba(201,168,76,0.2)] rounded-lg px-3 py-1.5">
              <p className="text-[#8888aa] text-[10px] mb-0.5 uppercase tracking-[0.05em] m-0">Custody</p>
              <p className="text-[#c9a84c] text-[11px] font-bold m-0">BITGO</p>
            </div>
            <button
              onClick={clearAuth}
              className="bg-[rgba(255,80,80,0.12)] border border-[rgba(255,80,80,0.3)] text-[#ff6060] text-[11px] font-semibold uppercase tracking-[0.05em] rounded-lg px-3 py-1.5 cursor-pointer transition-opacity hover:bg-[rgba(255,80,80,0.22)]"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Step indicator — deposit flow only */}
        {!isCashierView && step !== 'error' && (
          <div className="bg-[#16162a] px-8 py-4 flex items-center">
            {stepLabels.map((label, i) => (
              <div key={label} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i <= activeIndex ? 'bg-[#c9a84c] text-[#1a1a2e]' : 'bg-[#2a2a44] text-[#555577]'}`}>
                    {i < activeIndex ? '✓' : i + 1}
                  </div>
                  <span className={`text-xs font-semibold ${i === activeIndex ? 'text-[#c9a84c]' : i < activeIndex ? 'text-[#888866]' : 'text-[#444466]'}`}>{label}</span>
                </div>
                {i < stepLabels.length - 1 && <div className={`flex-1 h-px mx-3 ${i < activeIndex ? 'bg-[#c9a84c]' : 'bg-[#2a2a44]'}`} />}
              </div>
            ))}
          </div>
        )}

        {/* Main card */}
        <div className="bg-white rounded-b-2xl p-8 flex flex-col gap-5 shadow-[0_8px_40px_rgba(0,0,0,0.12)]">

          {error && step !== 'error' && (
            <div className="bg-[#fff5f5] border border-[#fca5a5] rounded-[10px] px-4 py-3 flex gap-2.5 items-start">
              <span className="text-red-500 text-sm">!</span>
              <p className="text-red-700 text-[13px] m-0 leading-normal">{error}</p>
            </div>
          )}

          {/* ── CASHIER: Enter chip amount ── */}
          {step === 'cashier' && (
            <div className="flex flex-col gap-6">
              <div className="text-center pt-2">
                <div className="text-[40px] mb-3">🎰</div>
                <h2 className="text-xl font-bold text-[#1a1a2e] m-0 mb-1.5">New Chip Exchange</h2>
                <p className="text-gray-500 text-sm m-0">Enter the chip amount to generate a one-time deposit address for the customer.</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-4 py-3 flex justify-between items-center">
                <span className="text-amber-800 text-[13px] font-semibold">Exchange rate</span>
                <span className="text-amber-800 text-sm font-bold">{config.chipsPerUsdc} chips per {config.assetSymbol}</span>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-gray-700 text-[13px] font-semibold">Chip Amount ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl font-bold">$</span>
                  <input
                    type="number" min="0" step="1" placeholder="0"
                    value={cashierAmount}
                    onChange={(e) => setCashierAmount(e.target.value)}
                    className="w-full py-3.5 pl-9 pr-4 rounded-[10px] border-2 border-gray-200 text-[28px] font-bold text-gray-900 outline-none bg-gray-50 focus:border-[#c9a84c]"
                  />
                </div>
                {cashierAmount && parseFloat(cashierAmount) > 0 && (
                  <div className="bg-green-50 border border-green-300 rounded-lg px-3.5 py-2.5 flex justify-between items-center">
                    <span className="text-green-800 text-[13px]">Customer pays</span>
                    <span className="text-green-800 text-base font-bold">{(parseFloat(cashierAmount) / config.chipsPerUsdc).toFixed(2)} {config.assetSymbol}</span>
                  </div>
                )}
              </div>
              <button onClick={generateDepositAddress} className="w-full py-4 rounded-[10px] border-none bg-[#1a1a2e] text-[#c9a84c] font-bold text-base cursor-pointer tracking-[0.03em]">
                Generate Deposit Address
              </button>
            </div>
          )}

          {/* ── CREATING: generating address ── */}
          {step === 'creating' && (
            <div className="flex flex-col items-center gap-5 py-10">
              <div className="w-12 h-12 rounded-full border-[3px] border-gray-200 border-t-[#c9a84c] animate-spin" />
              <p className="text-gray-600 text-sm m-0">{statusMsg || 'Generating secure deposit address...'}</p>
            </div>
          )}

          {/* ── DEPOSIT: show address/QR + live status ── */}
          {step === 'deposit' && intent && (
            <div className="flex flex-col gap-5">
              <div className="flex justify-between items-center">
                <h3 className="text-gray-900 text-base font-bold m-0">{statusCopy[status].title}</h3>
                <span className={`text-[13px] font-semibold px-3 py-1 rounded-full border ${timeLeft < 120 ? 'bg-red-50 text-red-600 border-[#fca5a5]' : 'bg-green-50 text-green-600 border-[#86efac]'}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>

              {/* Amount summary */}
              <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-5 py-3 flex gap-6 justify-center">
                <div className="text-center">
                  <p className="text-amber-800 text-[11px] font-semibold uppercase tracking-[0.06em] m-0 mb-0.5">Send exactly</p>
                  <p className="text-amber-800 text-[22px] font-extrabold m-0">{intent.usdcAmount} {config.assetSymbol}</p>
                </div>
                <div className="w-px bg-amber-200" />
                <div className="text-center">
                  <p className="text-amber-800 text-[11px] font-semibold uppercase tracking-[0.06em] m-0 mb-0.5">Chips</p>
                  <p className="text-amber-800 text-[22px] font-extrabold m-0">${intent.chipsAmount}</p>
                </div>
              </div>

              {/* QR + address — only meaningful while awaiting/detecting */}
              {(status === 'AWAITING' || status === 'DETECTED') && (
                <div className="bg-gray-50 border-2 border-gray-200 rounded-2xl p-5 flex flex-col items-center gap-4">
                  <QRCodeSVG value={intent.depositAddress} size={220} bgColor="#f9fafb" fgColor="#1a1a2e" level="M" />
                  <div className="w-full">
                    <p className="text-gray-400 text-[11px] font-semibold uppercase tracking-[0.06em] m-0 mb-1.5 text-center">
                      {config.assetSymbol} deposit address ({config.chainName})
                    </p>
                    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <span className="text-gray-700 text-xs font-mono break-all flex-1">{intent.depositAddress}</span>
                      <button onClick={copyAddress} className="shrink-0 text-[#c9a84c] text-xs font-semibold bg-[#1a1a2e] rounded-md px-2.5 py-1.5 cursor-pointer">
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-gray-400 text-[11px] text-center mt-2 m-0">
                      Send only {config.assetSymbol} on {config.chainName}. Funds auto-forward to treasury.
                    </p>
                  </div>
                </div>
              )}

              {/* Live status banner */}
              <div className={`rounded-[10px] border px-4 py-3.5 flex items-center gap-3 ${
                status === 'AWAITING' ? 'bg-blue-50 border-blue-200' :
                status === 'DETECTED' ? 'bg-indigo-50 border-indigo-200' :
                'bg-amber-50 border-amber-200'
              }`}>
                {status === 'AWAITING' ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-[#c9a84c] animate-spin shrink-0" />
                )}
                <div>
                  <p className="text-gray-800 text-[13px] font-semibold m-0">{statusCopy[status].title}</p>
                  <p className="text-gray-500 text-xs m-0">{statusCopy[status].sub}</p>
                </div>
              </div>

              {/* Tx link once detected */}
              {detectedTxHash && (
                <a href={`${explorerUrl}/tx/${detectedTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 text-xs font-mono no-underline bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-2 text-center">
                  Tx: {detectedTxHash.slice(0, 12)}...{detectedTxHash.slice(-10)} ↗
                </a>
              )}

              <CompliancePanel
                compliance={compliance}
                show={showFullAnalysis}
                onToggle={() => setShowFullAnalysis((v) => !v)}
              />

              <p className="text-gray-300 text-[11px] text-center m-0">Receipt: {intent.receiptId.slice(0, 14)}...{intent.receiptId.slice(-8)}</p>
              <button onClick={cancelDeposit} className="w-full py-3.25 rounded-[10px] border border-gray-200 bg-white text-gray-700 font-semibold text-sm cursor-pointer">
                Cancel
              </button>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && intent && (
            <div className="flex flex-col items-center gap-5 py-2">
              <div className="w-16 h-16 rounded-full bg-green-50 border-2 border-green-300 flex items-center justify-center text-[28px] text-green-600">✓</div>
              <div className="text-center">
                <h2 className="text-gray-900 text-xl font-bold m-0 mb-1.5">Deposit Confirmed</h2>
                <p className="text-gray-500 text-sm m-0">Chips have been issued</p>
              </div>
              <div className="w-full border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex justify-between px-4.5 py-3.5 border-b border-gray-100">
                  <span className="text-gray-500 text-sm">{config.assetSymbol} received</span>
                  <span className="text-gray-900 text-sm font-semibold">{(receivedAmount ?? intent.usdcAmount)} {config.assetSymbol}</span>
                </div>
                <div className="flex justify-between px-4.5 py-4 bg-amber-50">
                  <span className="text-amber-800 text-sm font-semibold">Chips issued</span>
                  <span className="text-amber-800 text-[22px] font-extrabold">${intent.chipsAmount}</span>
                </div>
              </div>

              {confirmedTxHash && (
                <a href={`${explorerUrl}/tx/${confirmedTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 text-[13px] no-underline text-center">
                  View deposit tx on explorer ↗
                </a>
              )}

              <CompliancePanel
                compliance={compliance}
                show={showFullAnalysis}
                onToggle={() => setShowFullAnalysis((v) => !v)}
              />

              <p className="text-gray-300 text-[11px] text-center m-0">Receipt: {intent.receiptId.slice(0, 14)}...{intent.receiptId.slice(-8)}</p>
              <button onClick={reset} className="w-full py-3.5 rounded-[10px] border-none bg-[#1a1a2e] text-[#c9a84c] font-bold text-[15px] cursor-pointer">
                New Transaction
              </button>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-5 py-2">
              <div className="w-16 h-16 rounded-full bg-red-50 border-2 border-red-300 flex items-center justify-center text-[28px] text-red-600">✕</div>
              <div className="text-center">
                <h2 className="text-gray-900 text-xl font-bold m-0 mb-2">{intent && status === 'EXPIRED' ? 'Deposit Expired' : 'Deposit Failed'}</h2>
                <p className="text-gray-500 text-sm m-0 leading-relaxed">{error}</p>
              </div>
              {confirmedTxHash && (
                <a href={`${explorerUrl}/tx/${confirmedTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 text-xs no-underline">
                  View tx on explorer ↗
                </a>
              )}
              <CompliancePanel
                compliance={compliance}
                show={showFullAnalysis}
                onToggle={() => setShowFullAnalysis((v) => !v)}
              />
              <button onClick={reset} className="w-full py-3.5 rounded-[10px] border border-gray-200 bg-white text-gray-700 font-semibold text-[15px] cursor-pointer">
                Try Again
              </button>
            </div>
          )}

        </div>

        <p className="text-center text-gray-400 text-xs mt-4">
          {config.chainName} · {config.assetSymbol} via BitGo custody
        </p>
      </div>
    </div>
  )
}

/** Collapsible BitGo compliance screening panel (replaces Chainalysis panel). */
function CompliancePanel({
  compliance,
  show,
  onToggle,
}: {
  compliance: ComplianceResult | null
  show: boolean
  onToggle: () => void
}) {
  if (!compliance) return null
  const s = compliance.status
  const wrapClass =
    s === 'PASS' ? 'bg-green-50 border-green-300' :
    s === 'REVIEW' ? 'bg-orange-50 border-orange-300' :
    s === 'FAIL' ? 'bg-red-50 border-red-300' :
    'bg-yellow-50 border-yellow-300'
  const badgeClass =
    s === 'PASS' ? 'bg-green-100 text-green-800' :
    s === 'REVIEW' ? 'bg-orange-100 text-orange-800' :
    s === 'FAIL' ? 'bg-red-100 text-red-800' :
    'bg-yellow-100 text-yellow-800'

  return (
    <div className={`rounded-[10px] border ${wrapClass}`}>
      <button onClick={onToggle} className="w-full flex justify-between items-center px-4 py-3.5 cursor-pointer bg-transparent border-none text-left">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-gray-500">BitGo Compliance Screen</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>{s}</span>
          <span className={`text-gray-400 text-[10px] transition-transform ${show ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>
      {show && (
        <div className="px-4 pb-3.5 flex flex-col gap-1.5 border-t border-black/5 pt-3">
          {compliance.risk && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Risk</span>
              <span className="text-xs text-gray-800 font-medium capitalize">{compliance.risk}</span>
            </div>
          )}
          {compliance.sourceAddress && (
            <div className="flex justify-between items-start gap-4">
              <span className="text-xs text-gray-500 shrink-0">Source</span>
              <span className="text-xs text-gray-800 font-mono text-right break-all">{compliance.sourceAddress}</span>
            </div>
          )}
          {compliance.error && (
            <div className="flex justify-between items-start gap-4">
              <span className="text-xs text-yellow-700 shrink-0">Screen Error</span>
              <span className="text-xs text-yellow-700 text-right">{compliance.error}</span>
            </div>
          )}
          {compliance.raw != null && (
            <div className="mt-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400">Raw Response</span>
              <pre className="mt-1 text-[10px] text-gray-600 bg-white/60 border border-black/10 rounded-lg p-2.5 overflow-x-auto leading-relaxed m-0 whitespace-pre-wrap break-all">{JSON.stringify(compliance.raw, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
