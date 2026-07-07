/**
 * Mempool monitoring service.
 *
 * Eliminates the "blind spot" between a player broadcasting their USDC transfer
 * and BitGo's confirmed webhook firing. The monitor watches the Ethereum
 * mempool (pending transactions) for USDC transfers destined for any of our
 * active deposit forwarder addresses and flips the intent to DETECTED the
 * instant the transaction is broadcast — before it is even mined.
 *
 * It also subscribes to confirmed ERC-20 Transfer logs as a safety net so the
 * UI can advance to CONFIRMING even if a webhook is delayed.
 *
 * Design: long-lived Node process (see mempool-service.ts). Cloud Functions are
 * ephemeral, so real-time mempool listening runs as a standalone worker.
 */
import { ethers } from 'ethers';
import { config } from './config.js';
import {
  getActiveIntents,
  getIntentByAddress,
  setStatus,
  expireStaleIntents,
} from './firestore.js';

const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const erc20Interface = new ethers.Interface(ERC20_TRANSFER_ABI);
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const USDC_DECIMALS = 6;

export class MempoolMonitor {
  private wsProvider: ethers.WebSocketProvider | null = null;
  private httpProvider: ethers.JsonRpcProvider | null = null;
  /** lowercased deposit address → receiptId */
  private watched = new Map<string, string>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private usdcAddress: string;
  private running = false;

  constructor() {
    this.usdcAddress = (config.network.usdcTokenAddress || '').toLowerCase();
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!config.network.wsRpcUrl) {
      throw new Error('ETH_WS_RPC_URL is required for mempool monitoring');
    }
    if (!this.usdcAddress) {
      throw new Error('USDC_TOKEN_ADDRESS is required for mempool monitoring');
    }
    this.running = true;

    if (config.network.httpRpcUrl) {
      this.httpProvider = new ethers.JsonRpcProvider(config.network.httpRpcUrl);
    }

    await this.refreshWatchList();
    this.refreshTimer = setInterval(() => {
      this.refreshWatchList().catch((e) =>
        console.error('[mempool] watch-list refresh failed:', e?.message)
      );
      expireStaleIntents().catch(() => {});
    }, 15_000);

    this.connect();
    console.log('[mempool] monitor started');
  }

  private connect(): void {
    const ws = new ethers.WebSocketProvider(config.network.wsRpcUrl);
    this.wsProvider = ws;

    // ── Real-time: pending (mempool) transactions ──
    ws.on('pending', (txHash: string) => {
      this.handlePending(txHash).catch(() => {});
    });

    // ── Safety net: confirmed USDC Transfer logs to our addresses ──
    ws.on(
      { address: this.usdcAddress, topics: [TRANSFER_TOPIC] },
      (log: ethers.Log) => {
        this.handleConfirmedLog(log).catch(() => {});
      }
    );

    // Auto-reconnect on socket drop.
    const socket = (ws.websocket as unknown as { on?: Function });
    if (socket && typeof socket.on === 'function') {
      socket.on('close', () => {
        if (!this.running) return;
        console.warn('[mempool] websocket closed, reconnecting in 3s');
        setTimeout(() => this.connect(), 3_000);
      });
      socket.on('error', (err: any) =>
        console.error('[mempool] websocket error:', err?.message)
      );
    }
  }

  /** Refresh the set of addresses we care about from Firestore. */
  private async refreshWatchList(): Promise<void> {
    const intents = await getActiveIntents();
    const next = new Map<string, string>();
    for (const intent of intents) {
      next.set(intent.depositAddress.toLowerCase(), intent.receiptId);
    }
    this.watched = next;
  }

  /** Inspect a pending mempool tx for a USDC transfer to a watched address. */
  private async handlePending(txHash: string): Promise<void> {
    if (this.watched.size === 0) return;
    const provider = this.wsProvider ?? this.httpProvider;
    if (!provider) return;

    try {
      const tx = await provider.getTransaction(txHash).catch(() => null);
      if (!tx || !tx.to) return;

      const to = tx.to.toLowerCase();

      // Case 1: USDC ERC-20 transfer — decode the recipient from calldata.
      if (to === this.usdcAddress && tx.data && tx.data !== '0x') {
        try {
          const parsed = erc20Interface.parseTransaction({ data: tx.data, value: tx.value });
          if (parsed?.name === 'transfer') {
            const recipient = (parsed.args[0] as string).toLowerCase();
            const amount = Number(ethers.formatUnits(parsed.args[1] as bigint, USDC_DECIMALS));
            await this.markDetected(recipient, txHash, amount, tx.from);
          }
        } catch {
          /* not a transfer call */
        }
        return;
      }

      // Case 2: native transfer straight to a forwarder address.
      if (this.watched.has(to)) {
        await this.markDetected(to, txHash, undefined, tx.from);
      }
    } catch (err: any) {
      console.error(`[mempool] error processing pending tx ${txHash}:`, err?.message);
    }
  }

  /** Handle a confirmed (mined) USDC Transfer log to a watched address. */
  private async handleConfirmedLog(log: ethers.Log): Promise<void> {
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = erc20Interface.parseLog({ topics: log.topics as string[], data: log.data });
    } catch {
      return;
    }
    if (!parsed || parsed.name !== 'Transfer') return;

    const recipient = (parsed.args[1] as string).toLowerCase();
    const receiptId = this.watched.get(recipient);
    if (!receiptId) return;

    const intent = await getIntentByAddress(recipient);
    if (!intent) return;
    // Only advance forward; never regress a CONFIRMED/COMPLETED intent.
    if (['CONFIRMED', 'COMPLETED', 'FAILED', 'EXPIRED'].includes(intent.status)) return;

    await setStatus(receiptId, 'CONFIRMING', { detectedTxHash: log.transactionHash });
    console.log(`[mempool] ${receiptId} → CONFIRMING (tx ${log.transactionHash})`);
  }

  /** Flip an intent to DETECTED (idempotently) when seen in the mempool. */
  private async markDetected(
    address: string,
    txHash: string,
    amount: number | undefined,
    from: string | null
  ): Promise<void> {
    const receiptId = this.watched.get(address);
    if (!receiptId) return;

    const intent = await getIntentByAddress(address);
    if (!intent) return;
    if (intent.status !== 'AWAITING') return; // already moved on

    await setStatus(receiptId, 'DETECTED', {
      detectedTxHash: txHash,
      detectedAt: Date.now(),
      sourceAddress: from ?? null,
      ...(amount !== undefined ? { receivedAmount: amount } : {}),
    });
    console.log(`[mempool] ${receiptId} → DETECTED (tx ${txHash})`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.wsProvider) await this.wsProvider.destroy().catch(() => {});
    this.wsProvider = null;
    console.log('[mempool] monitor stopped');
  }
}
