import 'dotenv/config.js';
import https from 'https';
import { config } from './lib/config.js';

const webhookUrl = process.argv[2];

if (!webhookUrl) {
  console.error('Usage: node register-webhook.mjs <webhook-url>');
  console.error('Example: node register-webhook.mjs https://us-central1-kv-crypto-app.cloudfunctions.net/cashier/webhook');
  process.exit(1);
}

console.log(`[admin] Registering BitGo webhook at: ${webhookUrl}`);
console.log(`[admin] BitGo environment: ${config.bitgo.env}`);
console.log(`[admin] BitGo wallet ID: ${config.bitgo.walletId}`);
console.log(`[admin] BitGo coin: ${config.bitgo.coin}`);

const baseCoin = (() => {
  const coin = config.bitgo.coin;
  if (coin.includes(':')) return coin.split(':')[0];
  if (coin === 'hterc6dp' || coin === 'hteth:tusdc') return 'hteth';
  if (coin === 'usdcv' || coin === 'eth:usdcv') return 'eth';
  return coin.split(':')[0];
})();
const bitgoHost = config.bitgo.env === 'test' ? 'app.bitgo-test.com' : 'app.bitgo.com';

const requestData = JSON.stringify({
  url: webhookUrl,
  type: 'transfer',
  numConfirmations: config.network.confirmations,
  allToken: true,
  listenToFailureStates: true,
});

const options = {
  hostname: bitgoHost,
  port: 443,
  path: `/api/v2/${baseCoin}/wallet/${config.bitgo.walletId}/webhooks`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': requestData.length,
    'Authorization': `Bearer ${config.bitgo.accessToken}`,
  },
};

console.log(`[admin] Making API request to: POST https://${bitgoHost}${options.path}`);

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(`[admin] Response status: ${res.statusCode}`);
    if (res.statusCode === 201 || res.statusCode === 200) {
      console.log('[admin] ✓ Webhook registered successfully');
      console.log('[admin] Response:', data);
      process.exit(0);
    } else {
      console.error('[admin] ✗ Failed to register webhook');
      console.error('[admin] Response:', data);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('[admin] ✗ Request failed:', err.message);
  process.exit(1);
});

req.write(requestData);
req.end();
