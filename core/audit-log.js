const SENSITIVE_KEY_RE = /(token|secret|password|api[_-]?key|authorization|cookie|session)/i;

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToken(value, {
  fallback,
  maxLen,
  allowHyphen = true
}) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;

  const pattern = allowHyphen ? /[^a-z0-9_-]+/g : /[^a-z0-9_]+/g;
  const cleaned = raw
    .replace(pattern, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function trimString(value, maxLen = 1000) {
  if (typeof value !== 'string') return value;
  return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
}

function redactSensitive(value, depth = 0) {
  if (depth > 6) {
    return { value: '[MAX_DEPTH]', redactedCount: 0 };
  }

  if (Array.isArray(value)) {
    let redactedCount = 0;
    const out = value.slice(0, 50).map((v) => {
      const item = redactSensitive(v, depth + 1);
      redactedCount += item.redactedCount;
      return item.value;
    });
    return { value: out, redactedCount };
  }

  if (isPlainObject(value)) {
    let redactedCount = 0;
    const out = {};

    for (const [k, v] of Object.entries(value).slice(0, 120)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
        redactedCount += 1;
        continue;
      }

      const nested = redactSensitive(v, depth + 1);
      redactedCount += nested.redactedCount;
      out[k] = nested.value;
    }

    return { value: out, redactedCount };
  }

  if (typeof value === 'string') {
    return { value: trimString(value, 1500), redactedCount: 0 };
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return { value, redactedCount: 0 };
  }

  return { value: trimString(String(value), 500), redactedCount: 0 };
}

function normalizeMetadata(metadata) {
  const base = isPlainObject(metadata)
    ? metadata
    : { raw: metadata };

  const { value: redacted, redactedCount } = redactSensitive(base);

  let normalized = isPlainObject(redacted) ? redacted : { value: redacted };
  const encoded = JSON.stringify(normalized);

  if (encoded.length > 12000) {
    normalized = {
      truncated: true,
      original_size: encoded.length,
      preview: encoded.slice(0, 2000)
    };
  }

  normalized._audit = {
    normalized: true,
    redacted_fields: redactedCount,
    normalized_at: new Date().toISOString()
  };

  return normalized;
}

function normalizeStatus(status) {
  if (status === 'success' || status === 'failure' || status === 'timeout') {
    return status;
  }
  return 'failure';
}

function normalizeDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(86_400_000, Math.round(value));
}

function normalizeAuditEvent({
  agentId,
  userId,
  sessionId,
  action,
  durationMs,
  status,
  errorMessage,
  metadata
}) {
  return {
    agentId: normalizeToken(agentId, {
      fallback: 'unknown-agent',
      maxLen: 50,
      allowHyphen: true
    }),
    userId: isUuid(userId) ? userId : null,
    sessionId: isUuid(sessionId) ? sessionId : null,
    action: normalizeToken(action, {
      fallback: 'unknown_action',
      maxLen: 100,
      allowHyphen: false
    }),
    durationMs: normalizeDuration(durationMs),
    status: normalizeStatus(status),
    errorMessage: typeof errorMessage === 'string' && errorMessage.trim()
      ? trimString(errorMessage.trim(), 2000)
      : null,
    metadata: normalizeMetadata(metadata)
  };
}

module.exports = {
  normalizeAuditEvent,
  normalizeMetadata,
  normalizeStatus,
  normalizeDuration,
  isUuid
};
