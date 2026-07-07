/**
 * Standalone entrypoint for the mempool monitor.
 *
 * Cloud Functions are short-lived and cannot hold a websocket open, so the
 * real-time mempool listener runs as a long-lived worker (e.g. Cloud Run,
 * a small VM, or `npm run mempool`). It shares the same Firestore project as
 * the HTTP functions, so DETECTED/CONFIRMING updates flow straight to the UI.
 *
 *   Build & run:  npm run build && npm run mempool
 *   Dev:          npm run mempool:dev
 */
import { MempoolMonitor } from './mempool.js';

const monitor = new MempoolMonitor();

const shutdown = async (signal: string) => {
  console.log(`[mempool-service] received ${signal}, shutting down...`);
  await monitor.stop();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) =>
  console.error('[mempool-service] unhandled rejection:', reason)
);

monitor.start().catch((err) => {
  console.error('[mempool-service] failed to start:', err?.message ?? err);
  process.exit(1);
});
