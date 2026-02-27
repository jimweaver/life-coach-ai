class CronEventDelivery {
  constructor(options = {}) {
    this.mode = String(options.mode ?? process.env.CRON_DELIVERY_MODE ?? 'none').toLowerCase();
    this.webhookUrl = options.webhookUrl ?? process.env.CRON_EVENT_WEBHOOK_URL ?? null;
    this.redis = options.redis ?? null;
    this.redisListKey = options.redisListKey ?? process.env.CRON_EVENT_REDIS_LIST_KEY ?? 'lifecoach:cron-events';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs ?? process.env.CRON_EVENT_TIMEOUT_MS ?? 5000);

    // Retry/backoff config
    this.retryMax = Number(options.retryMax ?? process.env.CRON_DELIVERY_RETRY_MAX ?? 5);
    this.retryBaseDelayMs = Number(options.retryBaseDelayMs ?? process.env.CRON_DELIVERY_RETRY_BASE_DELAY_MS ?? 1000);
    this.retryMaxDelayMs = Number(options.retryMaxDelayMs ?? process.env.CRON_DELIVERY_RETRY_MAX_DELAY_MS ?? 60000);
    this.retryJitter = options.retryJitter !== false;
  }

  /**
   * Calculate exponential backoff delay for a given attempt.
   * @param {number} attempt - 0-based attempt index
   * @returns {number} delay in milliseconds
   */
  calcBackoffMs(attempt) {
    const exp = Math.min(this.retryBaseDelayMs * Math.pow(2, attempt), this.retryMaxDelayMs);
    if (!this.retryJitter) return exp;
    // Full jitter: random between 0 and exp
    return Math.floor(Math.random() * exp);
  }

  /**
   * Deliver with retry/backoff. Returns enriched result with attempt info.
   * @param {object} envelope
   * @param {object} [opts]
   * @param {number} [opts.maxRetries] override instance retryMax
   * @param {function} [opts.sleep] injectable sleep (for testing)
   * @returns {Promise<object>}
   */
  async deliverWithRetry(envelope, opts = {}) {
    const maxRetries = opts.maxRetries ?? this.retryMax;
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    let lastResult = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = this.calcBackoffMs(attempt - 1);
        await sleep(delayMs);
      }

      try {
        lastResult = await this.deliver(envelope);
      } catch (err) {
        lastResult = {
          delivered: false,
          mode: this.mode,
          reason: err.message
        };
      }

      if (lastResult.delivered) {
        return {
          ...lastResult,
          attempts: attempt + 1,
          retried: attempt > 0
        };
      }
    }

    return {
      ...lastResult,
      attempts: maxRetries + 1,
      retried: maxRetries > 0,
      exhausted: true
    };
  }

  buildEnvelope({
    userId,
    cycle,
    message,
    severity = 'info',
    metadata = {}
  }) {
    return {
      kind: 'systemEvent',
      text: String(message || ''),
      source: 'life-coach-scheduler',
      event_type: 'scheduled_intervention',
      cycle,
      severity,
      user_id: userId || null,
      timestamp: new Date().toISOString(),
      metadata
    };
  }

  async deliver(envelope) {
    if (this.mode === 'none') {
      return { delivered: false, mode: 'none', reason: 'delivery disabled' };
    }

    if (this.mode === 'redis') {
      if (!this.redis) {
        return { delivered: false, mode: 'redis', reason: 'redis unavailable' };
      }

      await this.redis.rpush(this.redisListKey, JSON.stringify(envelope));
      return {
        delivered: true,
        mode: 'redis',
        target: this.redisListKey
      };
    }

    if (this.mode === 'webhook') {
      if (!this.webhookUrl) {
        return { delivered: false, mode: 'webhook', reason: 'webhook url missing' };
      }
      if (!this.fetchImpl) {
        return { delivered: false, mode: 'webhook', reason: 'fetch unavailable' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await this.fetchImpl(this.webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(envelope),
          signal: controller.signal
        });

        if (!res.ok) {
          return {
            delivered: false,
            mode: 'webhook',
            reason: `http_${res.status}`
          };
        }

        return {
          delivered: true,
          mode: 'webhook',
          target: this.webhookUrl,
          status: res.status
        };
      } finally {
        clearTimeout(timer);
      }
    }

    return { delivered: false, mode: this.mode, reason: 'unsupported_mode' };
  }

  async deliverBatch(envelopes = []) {
    const results = [];

    for (const envelope of envelopes) {
      try {
        results.push(await this.deliver(envelope));
      } catch (err) {
        results.push({
          delivered: false,
          mode: this.mode,
          reason: err.message
        });
      }
    }

    const delivered = results.filter((x) => x.delivered).length;
    return {
      total: envelopes.length,
      delivered,
      failed: envelopes.length - delivered,
      results
    };
  }
}

module.exports = CronEventDelivery;
