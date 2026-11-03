const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function currentLevel() {
  return LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;
}

function serialize(extra) {
  if (!extra || Object.keys(extra).length === 0) return '';
  const safe = {};
  for (const [key, value] of Object.entries(extra)) {
    if (value instanceof Error) {
      safe[key] = { message: value.message, code: value.code, stack: value.stack };
    } else {
      safe[key] = value;
    }
  }
  return ` ${JSON.stringify(safe)}`;
}

function emit(level, message, extra) {
  if (LEVELS[level] < currentLevel()) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${serialize(extra)}`;
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(bindings = {}) {
  const withBindings = (extra) => ({ ...bindings, ...extra });
  return {
    debug: (msg, extra) => emit('debug', msg, withBindings(extra)),
    info: (msg, extra) => emit('info', msg, withBindings(extra)),
    warn: (msg, extra) => emit('warn', msg, withBindings(extra)),
    error: (msg, extra) => emit('error', msg, withBindings(extra)),
    child: (extra) => createLogger(withBindings(extra)),
  };
}

export const logger = createLogger();
