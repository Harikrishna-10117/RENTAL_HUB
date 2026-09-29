function safeJson(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function createLogger(context = {}) {
  const base = { ...context };
  return {
    info(message, extra = {}) { console.log(JSON.stringify({ level: 'info', message, ...base, ...extra })); },
    warn(message, extra = {}) { console.warn(JSON.stringify({ level: 'warn', message, ...base, ...extra })); },
    error(message, extra = {}) { console.error(JSON.stringify({ level: 'error', message, ...base, ...extra })); }
  };
}

module.exports = { createLogger, safeJson };
