function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  keyFn = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown'
} = {}) {
  const bucket = new Map();

  return function rateLimiter(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    const existing = bucket.get(key) || [];
    const recent = existing.filter((ts) => ts > windowStart);

    if (recent.length >= maxRequests) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Please retry later.',
        retry_after_ms: windowMs
      });
    }

    recent.push(now);
    bucket.set(key, recent);
    next();
  };
}

function badRequest(res, details) {
  return res.status(400).json({
    error: 'validation_error',
    details
  });
}

function validateChatPayload(body) {
  const errors = [];
  const payload = body || {};

  if (!isUuid(payload.user_id)) errors.push('user_id must be a valid UUID');
  if (payload.session_id && !isUuid(payload.session_id)) {
    errors.push('session_id must be a valid UUID when provided');
  }
  if (typeof payload.message !== 'string' || payload.message.trim().length === 0) {
    errors.push('message must be a non-empty string');
  }
  if (typeof payload.message === 'string' && payload.message.length > 8000) {
    errors.push('message must be <= 8000 characters');
  }

  return errors;
}

function validateGoalPayload(body) {
  const errors = [];
  const payload = body || {};

  if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    errors.push('title is required');
  }

  if (payload.domain && !['career', 'finance', 'skill', 'health', 'relationship', 'decision'].includes(payload.domain)) {
    errors.push('domain must be one of career|finance|skill|health|relationship|decision');
  }

  if (payload.target_date && Number.isNaN(Date.parse(payload.target_date))) {
    errors.push('target_date must be a valid date string');
  }

  return errors;
}

function validateUserProfilePayload(body) {
  const errors = [];
  if (!isPlainObject(body || {})) {
    errors.push('profile payload must be a JSON object');
  }
  return errors;
}

function validateRiskPayload(body) {
  const alerts = body?.alerts;
  if (alerts === undefined) return [];
  if (!Array.isArray(alerts)) return ['alerts must be an array'];
  return [];
}

module.exports = {
  isUuid,
  createRateLimiter,
  badRequest,
  validateChatPayload,
  validateGoalPayload,
  validateUserProfilePayload,
  validateRiskPayload
};
