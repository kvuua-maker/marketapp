import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Minimal .env loader (no dotenv dependency).
 * Existing environment variables always win, so container/CI config is never
 * overridden by a stray file on disk.
 */
export function loadEnvFile(path) {
  const target = path instanceof URL ? fileURLToPath(path) : path;
  if (!existsSync(target)) return { loaded: false, path: target };

  const content = readFileSync(target, 'utf8');
  let applied = 0;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied += 1;
    }
  }

  return { loaded: true, path: target, applied };
}
