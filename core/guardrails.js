function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeClientId(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return 'unknown';

  const first = value.split(',')[0].trim();
  if (!first) return 'unknown';

  return first.replace(/[^a-zA-Z0-9:._-]/g, '_');
}

function defaultKeyFn(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return normalizeClientId(forwarded);
  return normalizeClientId(req.ip);
}

function buildRateLimitResponse(res, retryAfterMs) {
  return res.status(429).json({
    error: 'rate_limited',
    message: 'Too many requests. Please retry later.',
    retry_after_ms: retryAfterMs
  });
}

function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  keyFn = defaultKeyFn,
  onLimited = null
} = {}) {
  const bucket = new Map();

  return function rateLimiter(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    const existing = bucket.get(key) || [];
    const recent = existing.filter((ts) => ts > windowStart);

    if (recent.length >= maxRequests) {
      if (typeof onLimited === 'function') {
        Promise.resolve(onLimited({
          backend: 'memory',
          key,
          count: recent.length,
          maxRequests,
          windowMs,
          retryAfterMs: windowMs,
          route: req.path,
          method: req.method
        })).catch(() => {});
      }
      return buildRateLimitResponse(res, windowMs);
    }

    recent.push(now);
    bucket.set(key, recent);
    next();
  };
}

function createRedisRateLimiter({
  redis,
  windowMs = 60_000,
  maxRequests = 120,
  keyFn = defaultKeyFn,
  keyPrefix = 'lifecoach:rate-limit',
  fallbackToMemory = true,
  onLimited = null
} = {}) {
  const memoryFallback = createRateLimiter({ windowMs, maxRequests, keyFn, onLimited });

  if (!redis) {
    return memoryFallback;
  }

  return async function redisRateLimiter(req, res, next) {
    const clientKey = keyFn(req);
    const key = `${keyPrefix}:${clientKey}`;

    try {
      const pipeline = redis.multi();
      pipeline.incr(key);
      pipeline.pttl(key);

      const execResult = await pipeline.exec();
      const count = Number(execResult?.[0]?.[1] || 0);
      let ttlMs = Number(execResult?.[1]?.[1] || -1);

      if (count <= 0) {
        return next();
      }

      if (count === 1 || ttlMs < 0) {
        await redis.pexpire(key, windowMs);
        ttlMs = windowMs;
      }

      if (count > maxRequests) {
        const retryAfterMs = Math.max(1, ttlMs);
        if (typeof onLimited === 'function') {
          Promise.resolve(onLimited({
            backend: 'redis',
            key,
            count,
            maxRequests,
            windowMs,
            retryAfterMs,
            route: req.path,
            method: req.method
          })).catch(() => {});
        }
        return buildRateLimitResponse(res, retryAfterMs);
      }

      return next();
    } catch (err) {
      if (fallbackToMemory) {
        return memoryFallback(req, res, next);
      }
      return next(err);
    }
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
  createRedisRateLimiter,
  badRequest,
  validateChatPayload,
  validateGoalPayload,
  validateUserProfilePayload,
  validateRiskPayload
};
