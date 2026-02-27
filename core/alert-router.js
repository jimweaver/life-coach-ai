class AlertRouter {
  constructor(options = {}) {
    this.db = options.db || null;
    this.delivery = options.delivery || null;
    this.enabled = options.enabled ?? String(process.env.ALERT_ROUTING_ENABLED || 'true').toLowerCase() !== 'false';
    this.severityMin = String(options.severityMin ?? process.env.ALERT_ROUTING_MIN_LEVEL ?? 'warn').toLowerCase();
    this.eventType = options.eventType || 'delivery_alert';
  }

  levelRank(level) {
    const rank = { info: 1, warn: 2, warning: 2, critical: 3 };
    return rank[String(level || 'info').toLowerCase()] || 1;
  }

  shouldRoute(level) {
    if (!this.enabled) return false;
    return this.levelRank(level) >= this.levelRank(this.severityMin);
  }

  buildMessage(alert) {
    const level = String(alert?.level || 'info').toUpperCase();
    const reasons = Array.isArray(alert?.reasons) && alert.reasons.length
      ? alert.reasons.slice(0, 3).join('; ')
      : 'No explicit reason';

    const failureRate = alert?.metrics?.log?.failure_rate;
    const deadRecent = alert?.metrics?.outbox?.recent?.dead_letter;

    const parts = [
      `Life Coach Delivery Alert [${level}]`,
      `Reason: ${reasons}`
    ];

    if (typeof failureRate === 'number') {
      parts.push(`Failure rate: ${(failureRate * 100).toFixed(1)}%`);
    }

    if (typeof deadRecent === 'number') {
      parts.push(`Recent dead-letter: ${deadRecent}`);
    }

    parts.push('Action: check /jobs/delivery/metrics and /jobs/dead-letter');
    return parts.join(' | ');
  }

  buildMetadata(alert) {
    return {
      level: alert?.level || 'info',
      reasons: alert?.reasons || [],
      should_notify: !!alert?.should_notify,
      window_minutes: alert?.metrics?.log?.window_minutes || null,
      failure_rate: alert?.metrics?.log?.failure_rate ?? null,
      dead_letter_recent: alert?.metrics?.outbox?.recent?.dead_letter ?? null,
      dead_letter_total: alert?.trend?.dead_letter_total ?? null,
      growth_streak: alert?.trend?.growth_streak ?? null
    };
  }

  async routeDeliveryAlert(alert) {
    const level = String(alert?.level || 'info').toLowerCase();
    if (!this.shouldRoute(level) || !alert?.should_notify) {
      return {
        routed: false,
        reason: 'policy_skip',
        level,
        enabled: this.enabled,
        min_level: this.severityMin
      };
    }

    const message = this.buildMessage(alert);
    const metadata = this.buildMetadata(alert);

    const envelope = this.delivery?.buildEnvelope
      ? this.delivery.buildEnvelope({
        userId: null,
        cycle: 'delivery_alert',
        message,
        severity: level,
        metadata: {
          event_type: this.eventType,
          ...metadata
        }
      })
      : {
        kind: 'systemEvent',
        text: message,
        source: 'life-coach-alert-router',
        event_type: this.eventType,
        severity: level,
        timestamp: new Date().toISOString(),
        metadata
      };

    let deliveryResult = {
      delivered: false,
      mode: this.delivery?.mode || 'none',
      reason: 'delivery_unavailable'
    };

    if (this.delivery && typeof this.delivery.deliverWithRetry === 'function') {
      try {
        deliveryResult = await this.delivery.deliverWithRetry(envelope, {
          maxRetries: Number(process.env.ALERT_ROUTING_RETRY_MAX || 1)
        });
      } catch (err) {
        deliveryResult = {
          delivered: false,
          mode: this.delivery?.mode || 'unknown',
          reason: err.message
        };
      }
    }

    if (this.db?.logAgentAction) {
      try {
        await this.db.logAgentAction(
          'alert-router',
          null,
          null,
          'delivery_alert_routed',
          null,
          'success',
          null,
          {
            level,
            envelope,
            delivery: deliveryResult,
            metadata
          }
        );
      } catch (_e) {
        // best effort
      }
    }

    return {
      routed: !!deliveryResult.delivered,
      level,
      envelope,
      delivery: deliveryResult
    };
  }
}

module.exports = AlertRouter;
