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

    // Delivery statistics tracking
    this.deliveryStats = {
      total: 0,
      successful: 0,
      failed: 0,
      byMode: {
        redis: { total: 0, successful: 0, failed: 0 },
        webhook: { total: 0, successful: 0, failed: 0 },
        none: { total: 0, successful: 0, failed: 0 }
      },
      errorReasons: {},
      responseTimeMs: {
        total: 0,
        count: 0,
        min: null,
        max: null
      },
      recentErrors: [] // Last 50 errors
    };
  }

  /**
   * Record delivery attempt in statistics
   */
  recordDelivery(mode, success, responseTimeMs, reason = null) {
    this.deliveryStats.total++;
    this.deliveryStats.byMode[mode] = this.deliveryStats.byMode[mode] || { total: 0, successful: 0, failed: 0 };
    this.deliveryStats.byMode[mode].total++;

    if (success) {
      this.deliveryStats.successful++;
      this.deliveryStats.byMode[mode].successful++;
    } else {
      this.deliveryStats.failed++;
      this.deliveryStats.byMode[mode].failed++;

      // Track error reason
      if (reason) {
        this.deliveryStats.errorReasons[reason] = (this.deliveryStats.errorReasons[reason] || 0) + 1;
      }

      // Add to recent errors
      this.deliveryStats.recentErrors.push({
        mode,
        reason: reason || 'unknown',
        timestamp: new Date().toISOString()
      });
      // Keep only last 50
      if (this.deliveryStats.recentErrors.length > 50) {
        this.deliveryStats.recentErrors.shift();
      }
    }

    // Track response time
    if (responseTimeMs !== null) {
      this.deliveryStats.responseTimeMs.total += responseTimeMs;
      this.deliveryStats.responseTimeMs.count++;
      if (this.deliveryStats.responseTimeMs.min === null || responseTimeMs < this.deliveryStats.responseTimeMs.min) {
        this.deliveryStats.responseTimeMs.min = responseTimeMs;
      }
      if (this.deliveryStats.responseTimeMs.max === null || responseTimeMs > this.deliveryStats.responseTimeMs.max) {
        this.deliveryStats.responseTimeMs.max = responseTimeMs;
      }
    }
  }

  /**
   * Get delivery statistics
   */
  getDeliveryMetrics() {
    const avgResponseTime = this.deliveryStats.responseTimeMs.count > 0
      ? Math.round(this.deliveryStats.responseTimeMs.total / this.deliveryStats.responseTimeMs.count)
      : 0;

    return {
      total_deliveries: this.deliveryStats.total,
      successful: this.deliveryStats.successful,
      failed: this.deliveryStats.failed,
      success_rate: this.deliveryStats.total > 0
        ? ((this.deliveryStats.successful / this.deliveryStats.total) * 100).toFixed(2) + '%'
        : '0%',
      by_mode: Object.entries(this.deliveryStats.byMode).map(([mode, stats]) => ({
        mode,
        total: stats.total,
        successful: stats.successful,
        failed: stats.failed,
        success_rate: stats.total > 0
          ? ((stats.successful / stats.total) * 100).toFixed(2) + '%'
          : '0%'
      })).filter(m => m.total > 0).sort((a, b) => b.total - a.total),
      error_reasons: Object.entries(this.deliveryStats.errorReasons)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      response_time_ms: {
        avg: avgResponseTime,
        min: this.deliveryStats.responseTimeMs.min ?? 0,
        max: this.deliveryStats.responseTimeMs.max ?? 0
      },
      recent_errors: this.deliveryStats.recentErrors.slice(-5),
      generated_at: new Date().toISOString()
    };
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
    const startTime = Date.now();
    let result;

    if (this.mode === 'none') {
      result = { delivered: false, mode: 'none', reason: 'delivery disabled' };
      this.recordDelivery('none', false, Date.now() - startTime, 'delivery_disabled');
      return result;
    }

    if (this.mode === 'redis') {
      if (!this.redis) {
        result = { delivered: false, mode: 'redis', reason: 'redis unavailable' };
        this.recordDelivery('redis', false, Date.now() - startTime, 'redis_unavailable');
        return result;
      }

      try {
        await this.redis.rpush(this.redisListKey, JSON.stringify(envelope));
        result = {
          delivered: true,
          mode: 'redis',
          target: this.redisListKey
        };
        this.recordDelivery('redis', true, Date.now() - startTime);
        return result;
      } catch (err) {
        result = { delivered: false, mode: 'redis', reason: err.message };
        this.recordDelivery('redis', false, Date.now() - startTime, err.message);
        return result;
      }
    }

    if (this.mode === 'webhook') {
      if (!this.webhookUrl) {
        result = { delivered: false, mode: 'webhook', reason: 'webhook url missing' };
        this.recordDelivery('webhook', false, 0, 'webhook_url_missing');
        return result;
      }
      if (!this.fetchImpl) {
        result = { delivered: false, mode: 'webhook', reason: 'fetch unavailable' };
        this.recordDelivery('webhook', false, 0, 'fetch_unavailable');
        return result;
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
          result = {
            delivered: false,
            mode: 'webhook',
            reason: `http_${res.status}`
          };
          this.recordDelivery('webhook', false, Date.now() - startTime, `http_${res.status}`);
          return result;
        }

        result = {
          delivered: true,
          mode: 'webhook',
          target: this.webhookUrl,
          status: res.status
        };
        this.recordDelivery('webhook', true, Date.now() - startTime);
        return result;
      } catch (err) {
        result = {
          delivered: false,
          mode: 'webhook',
          reason: err.name === 'AbortError' ? 'timeout' : err.message
        };
        this.recordDelivery('webhook', false, Date.now() - startTime, result.reason);
        return result;
      } finally {
        clearTimeout(timer);
      }
    }

    result = { delivered: false, mode: this.mode, reason: 'unsupported_mode' };
    this.recordDelivery(this.mode, false, Date.now() - startTime, 'unsupported_mode');
    return result;
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
