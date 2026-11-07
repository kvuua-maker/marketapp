#!/usr/bin/env node
/**
 * Sends a test letter through the configured SMTP relay.
 *
 *   node --env-file=.env scripts/send-test-email.js --to=you@example.com
 */
import { config } from '../src/config.js';
import { createLogger } from '../src/core/logger.js';
import { sendViaSmtp, verifySmtp, smtpConfigured } from '../src/services/smtp.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const to = args.to || config.orders.emailFrom;
const logger = createLogger({ app: 'smtp-test' });

if (!smtpConfigured(config)) {
  console.error('SMTP is not configured: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and EMAIL_PROVIDER=smtp');
  process.exit(2);
}

console.log(`relay: ${config.orders.smtp.host}:${config.orders.smtp.port} (secure=${config.orders.smtp.secure})`);
console.log(`from:  ${config.orders.emailFrom}`);
console.log(`to:    ${to}`);
await verifySmtp({ config, logger });
console.log('verify: OK');
const info = await sendViaSmtp({
  config,
  logger,
  from: config.orders.emailFrom,
  to,
  subject: 'MarketApp SMTP test',
  text: `SMTP works. Sent at ${new Date().toISOString()}`,
  html: `<p>SMTP works.</p><p>Sent at ${new Date().toISOString()}</p>`,
});
console.log('sent:', info.messageId, info.response);
