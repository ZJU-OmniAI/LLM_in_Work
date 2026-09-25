import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
const dir = process.argv[2];
const pem = path.join(dir, 'localhost-cert.pem');
const ca = readFileSync(existsSync(pem) ? pem : path.join(dir, 'localhost.cer'));
// Windows Export-Certificate emits DER; convert to PEM for Node's CA option.
const trust = ca.toString().includes('BEGIN CERTIFICATE') ? ca : `-----BEGIN CERTIFICATE-----\n${ca.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
for (let i = 0; i < 15; i++) {
  const ok = await new Promise(resolve => {
    const req = https.get('https://127.0.0.1:8377/api/ping', { ca: trust, timeout: 2000 }, res => {
      let data = ''; res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(res.statusCode === 200 && JSON.parse(data).version === '0.7.0'); } catch { resolve(false); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false));
  });
  if (ok) { console.log('HTTPS certificate and LLM_in_Word 0.7.0 health check passed.'); process.exit(0); }
  await setTimeout(1000);
}
process.exitCode = 1;
