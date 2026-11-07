/**
 * SMTP delivery (Brevo and any standard STARTTLS relay).
 *
 * Enabled only when EMAIL_PROVIDER=smtp and SMTP_HOST/SMTP_USER/SMTP_PASS are
 * set, so the service keeps working with the outbox until credentials exist.
 */
import nodemailer from 'nodemailer';

let transporter = null;
let signature = '';

export function smtpConfigured(config) {
  const smtp = config?.orders?.smtp;
  return Boolean(smtp?.host && smtp?.user && smtp?.pass);
}

function getTransporter(config, logger) {
  const smtp = config.orders.smtp;
  const nextSignature = `${smtp.host}:${smtp.port}:${smtp.user}`;
  if (transporter && signature === nextSignature) return transporter;

  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  signature = nextSignature;
  logger?.info('smtp transport ready', { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user });
  return transporter;
}

export async function sendViaSmtp({ config, logger, from, to, subject, text, html }) {
  if (!smtpConfigured(config)) {
    throw new Error('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)');
  }
  const transport = getTransporter(config, logger);
  const info = await transport.sendMail({ from, to, subject, text, html });
  logger?.info('smtp email sent', { to, messageId: info.messageId, response: info.response });
  return info;
}

/** Verifies the relay credentials without sending a letter. */
export async function verifySmtp({ config, logger }) {
  const transport = getTransporter(config, logger);
  await transport.verify();
  return true;
}
