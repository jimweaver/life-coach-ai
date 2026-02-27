class AlertRouter {
  constructor(options = {}) {
    this.db = options.db || null;
    this.delivery = options.delivery || null;
    this.enabled = options.enabled ?? String(process.env.ALERT_ROUTING_ENABLED || 'true').toLowerCase() !== 'false';
    this.severityMin = String(options.severityMin ?? process.env.ALERT_ROUTING_MIN_LEVEL ?? 'warn').toLowerCase();
    this.eventType = options.eventType || 'delivery_alert';

    this.userId = options.userId ?? process.env.ALERT_ROUTING_USER_ID ?? null;
    this.userIdWarn = options.userIdWarn ?? process.env.ALERT_ROUTING_USER_ID_WARN ?? null;
    this.userIdCritical = options.userIdCritical ?? process.env.ALERT_ROUTING_USER_ID_CRITICAL ?? null;
    this.channel = options.channel ?? process.env.ALERT_ROUTING_CHANNEL ?? 'cron-event';

    const strategy = String(options.strategy ?? process.env.ALERT_ROUTING_STRATEGY ?? 'single').toLowerCase();
    this.strategy = strategy === 'severity' ? 'severity' : 'single';

    this.escalationEnabled = options.escalationEnabled ?? String(process.env.ALERT_ROUTING_ESCALATION_ENABLED || 'false').toLowerCase() !== 'false';
    this.escalationMinLevel = String(options.escalationMinLevel ?? process.env.ALERT_ROUTING_ESCALATION_MIN_LEVEL ?? 'critical').toLowerCase();
    this.escalationUserId = options.escalationUserId ?? process.env.ALERT_ROUTING_ESCALATION_USER_ID ?? null;
    this.escalationChannel = options.escalationChannel ?? process.env.ALERT_ROUTING_ESCALATION_CHANNEL ?? this.channel;
  }

  levelRank(level) {
    const rank = { info: 1, warn: 2, warning: 2, critical: 3 };
    return rank[String(level || 'info').toLowerCase()] || 1;
  }

  shouldRoute(level) {
    if (!this.enabled) return false;
    return this.levelRank(level) >= this.levelRank(this.severityMin);
  }

  resolveRouting(level) {
    const normalized = String(level || 'info').toLowerCase();

    let primaryUserId = this.userId || null;
    if (this.strategy === 'severity') {
      if (normalized === 'critical' && this.userIdCritical) {
        primaryUserId = this.userIdCritical;
      } else if ((normalized === 'warn' || normalized === 'warning') && this.userIdWarn) {
        primaryUserId = this.userIdWarn;
      }
    }

    const escalationTriggered = this.escalationEnabled
      && !!this.escalationUserId
      && this.levelRank(normalized) >= this.levelRank(this.escalationMinLevel)
      && this.escalationUserId !== primaryUserId;

    return {
      strategy: this.strategy,
      primaryUserId,
      primaryChannel: this.channel,
      escalation: {
        enabled: this.escalationEnabled,
        minLevel: this.escalationMinLevel,
        userId: this.escalationUserId,
        channel: this.escalationChannel,
        triggered: escalationTriggered
      }
    };
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

  async route(alert) {
    const kind = String(alert?.kind || 'generic_alert');
    const level = String(alert?.level || 'info').toLowerCase();
    const text = alert?.text || '';
    const metadata = alert?.metadata || {};
    const options = alert?.options || {};

    const targetUserId = options.toUserId || this.userId;
    const targetChannel = options.channel || this.channel;
    const maxRetries = Number(options.retryMax ?? process.env.ALERT_ROUTING_RETRY_MAX ?? 1);

    if (!this.enabled) {
      return {
        attempted: false,
        routed: false,
        reason: 'routing_disabled'
      };
    }

    if (!targetUserId) {
      return {
        attempted: false,
        routed: false,
        reason: 'no_target_user'
      };
    }

    const envelope = this.delivery?.buildEnvelope
      ? this.delivery.buildEnvelope({
        userId: targetUserId,
        cycle: kind,
        message: text,
        severity: level,
        metadata: {
          event_type: kind,
          route_channel: targetChannel,
          ...metadata
        }
      })
      : {
        kind: 'systemEvent',
        text,
        source: 'life-coach-alert-router',
        event_type: kind,
        severity: level,
        user_id: targetUserId,
        timestamp: new Date().toISOString(),
        metadata: {
          route_channel: targetChannel,
          ...metadata
        }
      };

    let delivery = null;
    if (this.delivery && typeof this.delivery.deliverWithRetry === 'function') {
      try {
        delivery = await this.delivery.deliverWithRetry(envelope, { maxRetries });
      } catch (err) {
        delivery = {
          delivered: false,
          mode: this.delivery?.mode || 'unknown',
          reason: err.message
        };
      }
    } else {
      delivery = {
        delivered: false,
        mode: this.delivery?.mode || 'none',
        reason: 'delivery_unavailable'
      };
    }

    if (this.db?.logAgentAction) {
      try {
        await this.db.logAgentAction(
          'alert-router',
          null,
          null,
          `${kind}_routed`,
          null,
          delivery?.delivered ? 'success' : 'failure',
          null,
          {
            kind,
            level,
            target_user_id: targetUserId,
            target_channel: targetChannel,
            envelope,
            delivery,
            metadata
          }
        );
      } catch (_e) {
        // best effort
      }
    }

    return {
      attempted: true,
      routed: !!delivery?.delivered,
      kind,
      level,
      target_user_id: targetUserId,
      target_channel: targetChannel,
      envelope,
      delivery
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
    const routing = this.resolveRouting(level);
    const maxRetries = Number(process.env.ALERT_ROUTING_RETRY_MAX || 1);

    const buildEnvelope = ({ eventType, userId, routeType, extra = {} }) => (
      this.delivery?.buildEnvelope
        ? this.delivery.buildEnvelope({
          userId,
          cycle: 'delivery_alert',
          message,
          severity: level,
          metadata: {
            event_type: eventType,
            route_type: routeType,
            route_strategy: routing.strategy,
            route_channel: routeType === 'primary' ? routing.primaryChannel : routing.escalation.channel,
            ...metadata,
            ...extra
          }
        })
        : {
          kind: 'systemEvent',
          text: message,
          source: 'life-coach-alert-router',
          event_type: eventType,
          severity: level,
          user_id: userId || null,
          timestamp: new Date().toISOString(),
          metadata: {
            route_type: routeType,
            route_strategy: routing.strategy,
            route_channel: routeType === 'primary' ? routing.primaryChannel : routing.escalation.channel,
            ...metadata,
            ...extra
          }
        }
    );

    const deliverEnvelope = async (envelope) => {
      if (this.delivery && typeof this.delivery.deliverWithRetry === 'function') {
        try {
          return await this.delivery.deliverWithRetry(envelope, { maxRetries });
        } catch (err) {
          return {
            delivered: false,
            mode: this.delivery?.mode || 'unknown',
            reason: err.message
          };
        }
      }

      return {
        delivered: false,
        mode: this.delivery?.mode || 'none',
        reason: 'delivery_unavailable'
      };
    };

    const primaryEnvelope = buildEnvelope({
      eventType: this.eventType,
      userId: routing.primaryUserId || null,
      routeType: 'primary'
    });
    const primaryDelivery = await deliverEnvelope(primaryEnvelope);

    let escalationEnvelope = null;
    let escalationDelivery = null;

    if (routing.escalation.triggered) {
      escalationEnvelope = buildEnvelope({
        eventType: `${this.eventType}_escalation`,
        userId: routing.escalation.userId,
        routeType: 'escalation',
        extra: {
          escalation_min_level: routing.escalation.minLevel,
          primary_user_id: routing.primaryUserId || null
        }
      });
      escalationDelivery = await deliverEnvelope(escalationEnvelope);
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
            routing,
            primary: {
              envelope: primaryEnvelope,
              delivery: primaryDelivery
            },
            escalation: routing.escalation.triggered
              ? {
                envelope: escalationEnvelope,
                delivery: escalationDelivery
              }
              : null,
            metadata
          }
        );
      } catch (_e) {
        // best effort
      }
    }

    return {
      routed: !!primaryDelivery?.delivered || !!escalationDelivery?.delivered,
      level,
      routing,
      envelope: primaryEnvelope,
      delivery: primaryDelivery,
      escalation: routing.escalation.triggered
        ? {
          envelope: escalationEnvelope,
          delivery: escalationDelivery
        }
        : null
    };
  }
}

module.exports = AlertRouter;
