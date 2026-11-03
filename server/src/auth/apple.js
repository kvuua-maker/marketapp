import { createPublicKey, verify } from 'node:crypto';
import { UnauthorizedError, ValidationError } from '../core/errors.js';

const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 10 * 60 * 1000;

let jwksCache = { keys: [], fetchedAt: 0 };

async function appleKeys() {
  if (jwksCache.keys.length > 0 && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const response = await fetch(APPLE_KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new UpstreamAuthError('Не вдалося отримати ключі Apple');
  const body = await response.json();
  jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

class UpstreamAuthError extends Error {}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * Verifies a Sign in with Apple identity token (RS256) against Apple's public
 * keys. No client secret is required for this direction of the flow.
 */
export async function verifyAppleIdentityToken(identityToken, clientId) {
  const parts = String(identityToken ?? '').split('.');
  if (parts.length !== 3) throw new ValidationError('Некоректний токен Apple');

  let header;
  let payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new ValidationError('Некоректний токен Apple');
  }

  let keys;
  try {
    keys = await appleKeys();
  } catch (error) {
    throw new UnauthorizedError(error.message);
  }

  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new UnauthorizedError('Ключ Apple не знайдено');

  let valid = false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    valid = verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new UnauthorizedError('Підпис Apple недійсний');

  if (payload.iss !== 'https://appleid.apple.com') throw new UnauthorizedError('Невірний видавець токена');
  if (clientId && payload.aud !== clientId) throw new UnauthorizedError('Токен видано для іншого застосунку');
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new UnauthorizedError('Токен прострочений');
  if (!payload.sub) throw new UnauthorizedError('У токені немає ідентифікатора користувача');

  return payload;
}
