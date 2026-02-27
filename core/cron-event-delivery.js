class CronEventDelivery {
  constructor(options = {}) {
    this.mode = String(options.mode ?? process.env.CRON_DELIVERY_MODE ?? 'none').toLowerCase();
    this.webhookUrl = options.webhookUrl ?? process.env.CRON_EVENT_WEBHOOK_URL ?? null;
    this.redis = options.redis ?? null;
    this.redisListKey = options.redisListKey ?? process.env.CRON_EVENT_REDIS_LIST_KEY ?? 'lifecoach:cron-events';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs ?? process.env.CRON_EVENT_TIMEOUT_MS ?? 5000);
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
