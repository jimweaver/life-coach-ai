const KBIMonitor = require('./kbi-monitor');
const InterventionEngine = require('./intervention-engine');
const CronEventDelivery = require('./cron-event-delivery');

class SchedulerRunner {
  constructor(db, options = {}) {
    this.db = db;
    this.kbiMonitor = new KBIMonitor();
    this.intervention = new InterventionEngine();

    this.delivery = options.delivery || new CronEventDelivery({
      redis: db?.redis
    });

    this.deliverMonitor = options.deliverMonitor ?? String(process.env.SCHEDULER_DELIVER_MONITOR || 'true').toLowerCase() !== 'false';
    this.deliverMorning = options.deliverMorning ?? String(process.env.SCHEDULER_DELIVER_MORNING || 'true').toLowerCase() !== 'false';
    this.inlineRetryMax = Number(options.inlineRetryMax ?? process.env.SCHEDULER_INLINE_RETRY_MAX ?? 1);

    const normalizeRouteStrategy = (value) => {
      const strategy = String(value || 'single').toLowerCase();
      if (strategy === 'severity') return 'severity';
      return 'single';
    };

    const normalizeLevel = (value, fallback = 'warn') => {
      const lv = String(value || fallback).toLowerCase();
      if (lv === 'warning') return 'warn';
      if (['info', 'warn', 'critical'].includes(lv)) return lv;
      return fallback;
    };

    this.deliveryAlertConfig = {
      minAttempts: Number(options.alertMinAttempts ?? process.env.DELIVERY_ALERT_MIN_ATTEMPTS ?? 3),
      warnFailureRate: Number(options.warnFailureRate ?? process.env.DELIVERY_ALERT_WARN_FAILURE_RATE ?? 0.2),
      criticalFailureRate: Number(options.criticalFailureRate ?? process.env.DELIVERY_ALERT_CRITICAL_FAILURE_RATE ?? 0.5),
      warnDeadLetterRecent: Number(options.warnDeadLetterRecent ?? process.env.DELIVERY_ALERT_WARN_DEAD_LETTER ?? 3),
      criticalDeadLetterRecent: Number(options.criticalDeadLetterRecent ?? process.env.DELIVERY_ALERT_CRITICAL_DEAD_LETTER ?? 8),
      warnGrowthStreak: Number(options.warnGrowthStreak ?? process.env.DELIVERY_ALERT_WARN_GROWTH_STREAK ?? 2),
      criticalGrowthStreak: Number(options.criticalGrowthStreak ?? process.env.DELIVERY_ALERT_CRITICAL_GROWTH_STREAK ?? 4),
      cooldownMinutes: Number(options.cooldownMinutes ?? process.env.DELIVERY_ALERT_COOLDOWN_MINUTES ?? 30),
      stateKey: options.alertStateKey ?? process.env.DELIVERY_ALERT_STATE_KEY ?? 'lifecoach:delivery-alert:state',
      stateTtlSec: Number(options.alertStateTtlSec ?? process.env.DELIVERY_ALERT_STATE_TTL_SEC ?? 604800),
      routeEnabled: options.alertRouteEnabled ?? String(process.env.DELIVERY_ALERT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
      routeRetryMax: Number(options.alertRouteRetryMax ?? process.env.DELIVERY_ALERT_ROUTE_RETRY_MAX ?? 1),
      routeUserId: options.alertRouteUserId ?? process.env.DELIVERY_ALERT_ROUTE_USER_ID ?? null,
      routeUserIdWarn: options.alertRouteUserIdWarn ?? process.env.DELIVERY_ALERT_ROUTE_USER_ID_WARN ?? null,
      routeUserIdCritical: options.alertRouteUserIdCritical ?? process.env.DELIVERY_ALERT_ROUTE_USER_ID_CRITICAL ?? null,
      routeChannel: options.alertRouteChannel ?? process.env.DELIVERY_ALERT_ROUTE_CHANNEL ?? 'cron-event',
      routeStrategy: normalizeRouteStrategy(options.alertRouteStrategy ?? process.env.DELIVERY_ALERT_ROUTE_STRATEGY ?? 'single'),
      escalationEnabled: options.alertEscalationEnabled ?? String(process.env.DELIVERY_ALERT_ESCALATION_ENABLED || 'false').toLowerCase() !== 'false',
      escalationMinLevel: normalizeLevel(options.alertEscalationMinLevel ?? process.env.DELIVERY_ALERT_ESCALATION_MIN_LEVEL ?? 'critical', 'critical'),
      escalationUserId: options.alertEscalationUserId ?? process.env.DELIVERY_ALERT_ESCALATION_USER_ID ?? null,
      escalationChannel: options.alertEscalationChannel ?? process.env.DELIVERY_ALERT_ESCALATION_CHANNEL ?? (process.env.DELIVERY_ALERT_ROUTE_CHANNEL || 'cron-event')
    };
  }

  hasOutboxSupport() {
    return Boolean(
      this.db
      && typeof this.db.enqueueOutboundEvent === 'function'
      && typeof this.db.markOutboundEventDispatched === 'function'
      && typeof this.db.markOutboundEventFailed === 'function'
    );
  }

  hasDeliveryMetricsSupport() {
    return Boolean(
      this.db
      && typeof this.db.getSchedulerDeliveryMetrics === 'function'
      && typeof this.db.getOutboundEventStats === 'function'
    );
  }

  async loadDeliveryAlertState() {
    const key = this.deliveryAlertConfig.stateKey;

    if (!this.db?.redis || !key) {
      return {
        last_dead_letter_total: 0,
        growth_streak: 0,
        last_alert_at_ms: 0,
        last_alert_level: 'info'
      };
    }

    try {
      const raw = await this.db.redis.get(key);
      if (!raw) {
        return {
          last_dead_letter_total: 0,
          growth_streak: 0,
          last_alert_at_ms: 0,
          last_alert_level: 'info'
        };
      }
      const parsed = JSON.parse(raw);
      return {
        last_dead_letter_total: Number(parsed.last_dead_letter_total || 0),
        growth_streak: Number(parsed.growth_streak || 0),
        last_alert_at_ms: Number(parsed.last_alert_at_ms || 0),
        last_alert_level: parsed.last_alert_level || 'info'
      };
    } catch (_e) {
      return {
        last_dead_letter_total: 0,
        growth_streak: 0,
        last_alert_at_ms: 0,
        last_alert_level: 'info'
      };
    }
  }

  async saveDeliveryAlertState(state) {
    const key = this.deliveryAlertConfig.stateKey;
    if (!this.db?.redis || !key) return;

    try {
      await this.db.redis.setex(
        key,
        Math.max(60, this.deliveryAlertConfig.stateTtlSec),
        JSON.stringify(state)
      );
    } catch (_e) {
      // best effort
    }
  }

  compareAlertLevel(a, b) {
    const rank = { info: 1, warn: 2, critical: 3 };
    return (rank[a] || 0) - (rank[b] || 0);
  }

  buildDeliveryAlertText({ level, reasons, trend, metrics }) {
    const headline = level === 'critical'
      ? '🚨 Delivery Alert (CRITICAL)'
      : '⚠️ Delivery Alert (WARN)';

    const reasonText = Array.isArray(reasons) && reasons.length
      ? reasons.slice(0, 3).join(' | ')
      : 'delivery risk threshold reached';

    const dead = trend?.dead_letter_total ?? 0;
    const growth = trend?.growth ?? 0;
    const failureRate = metrics?.log?.failure_rate ?? 0;

    return `${headline}\nreasons: ${reasonText}\nmetrics: dead_letter=${dead}, growth=${growth}, failure_rate=${failureRate}`;
  }

  normalizeAlertLevel(level) {
    const lv = String(level || 'info').toLowerCase();
    if (lv === 'warning') return 'warn';
    if (['info', 'warn', 'critical'].includes(lv)) return lv;
    return 'info';
  }

  resolveAlertRouting(level) {
    const cfg = this.deliveryAlertConfig;
    const normalizedLevel = this.normalizeAlertLevel(level);

    let primaryUserId = cfg.routeUserId || null;
    if (cfg.routeStrategy === 'severity') {
      if (normalizedLevel === 'critical' && cfg.routeUserIdCritical) {
        primaryUserId = cfg.routeUserIdCritical;
      } else if (normalizedLevel === 'warn' && cfg.routeUserIdWarn) {
        primaryUserId = cfg.routeUserIdWarn;
      }
    }

    const primaryChannel = cfg.routeChannel || 'cron-event';

    const escalationTriggered = cfg.escalationEnabled
      && !!cfg.escalationUserId
      && this.compareAlertLevel(normalizedLevel, cfg.escalationMinLevel || 'critical') >= 0
      && cfg.escalationUserId !== primaryUserId;

    return {
      level: normalizedLevel,
      strategy: cfg.routeStrategy || 'single',
      primaryUserId,
      primaryChannel,
      escalation: {
        enabled: !!cfg.escalationEnabled,
        minLevel: cfg.escalationMinLevel || 'critical',
        userId: cfg.escalationUserId || null,
        channel: cfg.escalationChannel || 'cron-event',
        triggered: escalationTriggered
      }
    };
  }

  async deliverAlertEnvelope({
    envelope,
    eventType,
    userId,
    channel,
    level,
    reasons,
    routeType,
    maxRetries
  }) {
    const outbox = {
      queued: false,
      event_id: null,
      status: this.hasOutboxSupport() ? 'not_queued' : 'not_supported',
      error: null
    };

    if (this.hasOutboxSupport()) {
      try {
        outbox.event_id = await this.db.enqueueOutboundEvent({
          eventType,
          userId,
          channel,
          source: 'scheduler-alert',
          payload: envelope
        });
        outbox.queued = true;
        outbox.status = 'queued';
      } catch (err) {
        outbox.status = 'queue_failed';
        outbox.error = err.message;
      }
    }

    let deliveryResult;
    try {
      deliveryResult = await this.delivery.deliverWithRetry(envelope, { maxRetries });
    } catch (err) {
      deliveryResult = {
        delivered: false,
        mode: this.delivery?.mode || 'unknown',
        reason: err.message,
        attempts: 1,
        retried: false,
        exhausted: false
      };
    }

    if (outbox.event_id) {
      try {
        if (deliveryResult?.delivered) {
          await this.db.markOutboundEventDispatched(outbox.event_id, {
            delivery: deliveryResult,
            alert: { level, reasons, route_type: routeType }
          });
          outbox.status = 'dispatched';
        } else {
          await this.db.markOutboundEventFailed(
            outbox.event_id,
            deliveryResult?.reason || 'delivery_alert_delivery_failed',
            {
              delivery: deliveryResult,
              alert: { level, reasons, route_type: routeType }
            }
          );
          outbox.status = 'failed';
        }
      } catch (err) {
        outbox.status = 'failed';
        outbox.error = outbox.error || err.message;
      }
    }

    return {
      dispatched: !!deliveryResult?.delivered,
      envelope,
      delivery: deliveryResult,
      outbox
    };
  }

  async dispatchDeliveryAlert({
    level,
    reasons,
    windowMinutes,
    metrics,
    trend,
    config
  }) {
    const routeCfg = this.deliveryAlertConfig;

    if (this.delivery?.mode === 'none') {
      return {
        dispatched: false,
        skipped: true,
        reason: 'delivery_mode_none'
      };
    }

    const routing = this.resolveAlertRouting(level);

    const maxRetries = Number.isInteger(routeCfg.routeRetryMax)
      ? Math.max(0, routeCfg.routeRetryMax)
      : 1;

    const primaryEnvelope = {
      kind: 'systemEvent',
      text: this.buildDeliveryAlertText({ level: routing.level, reasons, trend, metrics }),
      source: 'life-coach-alerting',
      event_type: 'delivery_alert_triggered',
      cycle: 'delivery-alert',
      severity: routing.level,
      user_id: routing.primaryUserId || null,
      timestamp: new Date().toISOString(),
      metadata: {
        level: routing.level,
        reasons,
        window_minutes: windowMinutes,
        metrics,
        trend,
        config,
        routing: {
          strategy: routing.strategy,
          route_type: 'primary',
          channel: routing.primaryChannel,
          user_id: routing.primaryUserId || null
        }
      }
    };

    const primary = await this.deliverAlertEnvelope({
      envelope: primaryEnvelope,
      eventType: 'delivery_alert.triggered',
      userId: routing.primaryUserId || null,
      channel: routing.primaryChannel,
      level: routing.level,
      reasons,
      routeType: 'primary',
      maxRetries
    });

    let escalation = null;
    if (routing.escalation.triggered) {
      const escalationEnvelope = {
        kind: 'systemEvent',
        text: this.buildDeliveryAlertText({ level: routing.level, reasons, trend, metrics }),
        source: 'life-coach-alerting',
        event_type: 'delivery_alert_escalation',
        cycle: 'delivery-alert',
        severity: routing.level,
        user_id: routing.escalation.userId,
        timestamp: new Date().toISOString(),
        metadata: {
          level: routing.level,
          reasons,
          window_minutes: windowMinutes,
          metrics,
          trend,
          config,
          routing: {
            strategy: routing.strategy,
            route_type: 'escalation',
            channel: routing.escalation.channel,
            user_id: routing.escalation.userId,
            primary_user_id: routing.primaryUserId || null,
            escalation_min_level: routing.escalation.minLevel
          }
        }
      };

      escalation = await this.deliverAlertEnvelope({
        envelope: escalationEnvelope,
        eventType: 'delivery_alert.escalation',
        userId: routing.escalation.userId,
        channel: routing.escalation.channel,
        level: routing.level,
        reasons,
        routeType: 'escalation',
        maxRetries
      });
    }

    return {
      dispatched: !!primary.dispatched,
      envelope: primary.envelope,
      delivery: primary.delivery,
      outbox: primary.outbox,
      routing: {
        strategy: routing.strategy,
        primary_user_id: routing.primaryUserId || null,
        primary_channel: routing.primaryChannel,
        escalation_enabled: routing.escalation.enabled,
        escalation_min_level: routing.escalation.minLevel,
        escalation_triggered: routing.escalation.triggered,
        escalation_user_id: routing.escalation.userId,
        escalation_channel: routing.escalation.channel
      },
      primary,
      escalation
    };
  }

  async evaluateDeliveryAlert({ windowMinutes = 60, limit = 500, emitAudit = true } = {}) {
    if (!this.hasDeliveryMetricsSupport()) {
      return { ok: false, reason: 'delivery_alert_not_supported' };
    }

    const [logMetrics, outbox] = await Promise.all([
      this.db.getSchedulerDeliveryMetrics({ windowMinutes, limit }),
      this.db.getOutboundEventStats(windowMinutes)
    ]);

    const cfg = this.deliveryAlertConfig;
    const reasons = [];
    let level = 'info';

    const raise = (newLevel, reason) => {
      if (this.compareAlertLevel(newLevel, level) > 0) {
        level = newLevel;
      }
      reasons.push(reason);
    };

    if (outbox?.recent?.dead_letter >= cfg.criticalDeadLetterRecent) {
      raise('critical', `recent dead_letter count ${outbox.recent.dead_letter} >= ${cfg.criticalDeadLetterRecent}`);
    } else if (outbox?.recent?.dead_letter >= cfg.warnDeadLetterRecent) {
      raise('warn', `recent dead_letter count ${outbox.recent.dead_letter} >= ${cfg.warnDeadLetterRecent}`);
    }

    if (logMetrics?.attempted_deliveries >= cfg.minAttempts) {
      if (logMetrics.failure_rate >= cfg.criticalFailureRate) {
        raise('critical', `delivery failure rate ${logMetrics.failure_rate} >= ${cfg.criticalFailureRate}`);
      } else if (logMetrics.failure_rate >= cfg.warnFailureRate) {
        raise('warn', `delivery failure rate ${logMetrics.failure_rate} >= ${cfg.warnFailureRate}`);
      }
    }

    const prevState = await this.loadDeliveryAlertState();
    const deadLetterTotal = Number(outbox?.total?.dead_letter || 0);
    const growth = Math.max(0, deadLetterTotal - Number(prevState.last_dead_letter_total || 0));
    const growthStreak = growth > 0 ? Number(prevState.growth_streak || 0) + 1 : 0;

    if (growthStreak >= cfg.criticalGrowthStreak) {
      raise('critical', `dead-letter growth streak ${growthStreak} >= ${cfg.criticalGrowthStreak}`);
    } else if (growthStreak >= cfg.warnGrowthStreak) {
      raise('warn', `dead-letter growth streak ${growthStreak} >= ${cfg.warnGrowthStreak}`);
    }

    const nowMs = Date.now();
    const cooldownMs = Math.max(0, cfg.cooldownMinutes) * 60_000;
    const lastAlertAtMs = Number(prevState.last_alert_at_ms || 0);
    const isHigherThanLast = this.compareAlertLevel(level, prevState.last_alert_level || 'info') > 0;

    const shouldNotify = level !== 'info'
      && (
        lastAlertAtMs === 0
        || (nowMs - lastAlertAtMs) >= cooldownMs
        || isHigherThanLast
      );

    const nextState = {
      last_dead_letter_total: deadLetterTotal,
      growth_streak: growthStreak,
      last_alert_at_ms: shouldNotify ? nowMs : lastAlertAtMs,
      last_alert_level: shouldNotify ? level : (prevState.last_alert_level || 'info')
    };

    await this.saveDeliveryAlertState(nextState);

    let alertDelivery = null;
    if (shouldNotify && cfg.routeEnabled) {
      alertDelivery = await this.dispatchDeliveryAlert({
        level,
        reasons,
        windowMinutes,
        metrics: {
          log: logMetrics,
          outbox
        },
        trend: {
          dead_letter_total: deadLetterTotal,
          previous_dead_letter_total: Number(prevState.last_dead_letter_total || 0),
          growth,
          growth_streak: growthStreak
        },
        config: {
          min_attempts: cfg.minAttempts,
          warn_failure_rate: cfg.warnFailureRate,
          critical_failure_rate: cfg.criticalFailureRate,
          warn_dead_letter_recent: cfg.warnDeadLetterRecent,
          critical_dead_letter_recent: cfg.criticalDeadLetterRecent,
          warn_growth_streak: cfg.warnGrowthStreak,
          critical_growth_streak: cfg.criticalGrowthStreak,
          cooldown_minutes: cfg.cooldownMinutes
        }
      });
    }

    if (emitAudit && shouldNotify && typeof this.db.logAgentAction === 'function') {
      try {
        await this.db.logAgentAction(
          'delivery-alert',
          null,
          null,
          'delivery_alert_triggered',
          null,
          'success',
          null,
          {
            level,
            reasons,
            window_minutes: windowMinutes,
            cooldown_minutes: cfg.cooldownMinutes,
            log_metrics: logMetrics,
            outbox_recent: outbox?.recent,
            outbox_total_dead_letter: deadLetterTotal,
            growth,
            growth_streak: growthStreak,
            alert_delivery: alertDelivery
          }
        );
      } catch (_e) {
        // best effort
      }
    }

    return {
      ok: true,
      level,
      should_notify: shouldNotify,
      reasons,
      alert_delivery: alertDelivery,
      metrics: {
        log: logMetrics,
        outbox
      },
      trend: {
        dead_letter_total: deadLetterTotal,
        previous_dead_letter_total: Number(prevState.last_dead_letter_total || 0),
        growth,
        growth_streak: growthStreak
      },
      config: {
        min_attempts: cfg.minAttempts,
        warn_failure_rate: cfg.warnFailureRate,
        critical_failure_rate: cfg.criticalFailureRate,
        warn_dead_letter_recent: cfg.warnDeadLetterRecent,
        critical_dead_letter_recent: cfg.criticalDeadLetterRecent,
        warn_growth_streak: cfg.warnGrowthStreak,
        critical_growth_streak: cfg.criticalGrowthStreak,
        cooldown_minutes: cfg.cooldownMinutes,
        route_enabled: cfg.routeEnabled,
        route_retry_max: cfg.routeRetryMax,
        route_strategy: cfg.routeStrategy,
        route_channel: cfg.routeChannel,
        route_user_id: cfg.routeUserId || null,
        route_user_id_warn: cfg.routeUserIdWarn || null,
        route_user_id_critical: cfg.routeUserIdCritical || null,
        escalation_enabled: cfg.escalationEnabled,
        escalation_min_level: cfg.escalationMinLevel,
        escalation_user_id: cfg.escalationUserId || null,
        escalation_channel: cfg.escalationChannel || null
      }
    };
  }

  async dispatchIntervention({ userId, cycle, message, severity = 'info', metadata = {} }) {
    const envelope = this.delivery.buildEnvelope({
      userId,
      cycle,
      message,
      severity,
      metadata
    });

    const outbox = {
      queued: false,
      event_id: null,
      status: this.hasOutboxSupport() ? 'not_queued' : 'not_supported',
      error: null
    };

    if (this.hasOutboxSupport()) {
      try {
        outbox.event_id = await this.db.enqueueOutboundEvent({
          eventType: `scheduled_intervention.${cycle}`,
          userId,
          channel: 'cron-event',
          source: 'scheduler-runner',
          payload: envelope
        });
        outbox.queued = true;
        outbox.status = 'queued';
      } catch (err) {
        outbox.status = 'queue_failed';
        outbox.error = err.message;
      }
    }

    const maxRetries = Number.isInteger(this.inlineRetryMax)
      ? Math.max(0, this.inlineRetryMax)
      : 1;

    let deliveryResult;
    try {
      if (typeof this.delivery?.deliverWithRetry === 'function') {
        deliveryResult = await this.delivery.deliverWithRetry(envelope, { maxRetries });
      } else {
        const oneShot = await this.delivery.deliver(envelope);
        deliveryResult = {
          ...oneShot,
          attempts: 1,
          retried: false
        };
      }
    } catch (err) {
      deliveryResult = {
        delivered: false,
        mode: this.delivery?.mode || 'unknown',
        reason: err.message,
        attempts: 1,
        retried: false,
        exhausted: false
      };
    }

    if (outbox.event_id) {
      try {
        if (deliveryResult?.delivered) {
          await this.db.markOutboundEventDispatched(outbox.event_id, {
            delivery: deliveryResult
          });
          outbox.status = 'dispatched';
        } else {
          await this.db.markOutboundEventFailed(
            outbox.event_id,
            deliveryResult?.reason || 'delivery_failed',
            { delivery: deliveryResult }
          );
          outbox.status = 'failed';
        }
      } catch (err) {
        outbox.status = 'failed';
        outbox.error = outbox.error || err.message;
      }
    }

    return {
      envelope,
      deliveryResult,
      outbox
    };
  }

  async runMonitorCycle({ limitUsers = 100 } = {}) {
    const users = await this.db.listUserIds(limitUsers);

    const summary = {
      scannedUsers: users.length,
      withData: 0,
      criticalUsers: 0,
      warnUsers: 0,
      interventions: 0,
      deliveredEvents: 0,
      deliveryFailures: 0,
      outboxQueued: 0,
      outboxDispatched: 0,
      outboxFailed: 0,
      results: []
    };

    for (const userId of users) {
      const snapshot = await this.db.getLatestKbiSnapshot(userId);
      const hasData = Object.keys(snapshot).length > 0;

      if (!hasData) {
        summary.results.push({ userId, status: 'no_data' });
        continue;
      }

      summary.withData += 1;
      const evaluation = this.kbiMonitor.evaluateSnapshot(snapshot);

      if (evaluation.hasCritical) summary.criticalUsers += 1;
      if (evaluation.hasWarn) summary.warnUsers += 1;

      const interventionMsg = this.intervention.buildRiskIntervention(evaluation.alerts);
      if (interventionMsg) summary.interventions += 1;

      let deliveryResult = null;
      let outbox = null;

      if (interventionMsg && this.deliverMonitor) {
        const dispatch = await this.dispatchIntervention({
          userId,
          cycle: 'monitor',
          message: interventionMsg,
          severity: evaluation.hasCritical ? 'critical' : (evaluation.hasWarn ? 'warning' : 'info'),
          metadata: {
            overall: evaluation.overall,
            alerts: evaluation.alerts,
            snapshot
          }
        });

        deliveryResult = dispatch.deliveryResult;
        outbox = dispatch.outbox;

        if (deliveryResult?.delivered) {
          summary.deliveredEvents += 1;
        } else if (this.delivery.mode !== 'none') {
          summary.deliveryFailures += 1;
        }

        if (outbox?.queued) summary.outboxQueued += 1;
        if (outbox?.status === 'dispatched') summary.outboxDispatched += 1;
        if (outbox?.status === 'failed' || outbox?.status === 'queue_failed') summary.outboxFailed += 1;
      }

      await this.db.logAgentAction(
        'kbi-monitor',
        userId,
        null,
        'scheduled_monitor_cycle',
        null,
        'success',
        null,
        {
          evaluation,
          intervention_message: interventionMsg,
          delivery: deliveryResult,
          outbox
        }
      );

      summary.results.push({
        userId,
        status: 'evaluated',
        overall: evaluation.overall,
        intervention: interventionMsg || null,
        delivered: !!deliveryResult?.delivered,
        outbox_event_id: outbox?.event_id || null,
        outbox_status: outbox?.status || null
      });
    }

    return summary;
  }

  /**
   * Retry cycle: picks up failed outbound events, re-delivers, and dead-letters exhausted ones.
   */
  async runRetryCycle({ limit = 50 } = {}) {
    if (!this.hasOutboxSupport() || typeof this.db.getRetryableEvents !== 'function') {
      return { ok: false, reason: 'outbox_retry_not_supported' };
    }

    const retryable = await this.db.getRetryableEvents({ limit });

    const summary = {
      found: retryable.length,
      retried: 0,
      delivered: 0,
      failed: 0,
      dead_lettered: 0,
      results: []
    };

    for (const event of retryable) {
      const envelope = event.payload || {};
      let deliveryResult;

      try {
        deliveryResult = await this.delivery.deliver(envelope);
      } catch (err) {
        deliveryResult = {
          delivered: false,
          mode: this.delivery?.mode || 'unknown',
          reason: err.message
        };
      }

      summary.retried += 1;
      const newRetryCount = (event.retry_count || 0) + 1;
      const maxRetries = event.max_retries || this.delivery.retryMax || 5;

      if (deliveryResult?.delivered) {
        // Success — mark dispatched
        await this.db.markOutboundEventDispatched(event.event_id, {
          delivery: deliveryResult,
          retry_attempt: newRetryCount
        });
        summary.delivered += 1;

        summary.results.push({
          event_id: event.event_id,
          status: 'dispatched',
          retry_attempt: newRetryCount
        });
      } else if (newRetryCount >= maxRetries) {
        // Exhausted — dead-letter
        await this.db.incrementRetryCount(event.event_id, null);
        await this.db.markOutboundEventDeadLetter(
          event.event_id,
          deliveryResult?.reason || 'retries_exhausted',
          { delivery: deliveryResult, retry_attempt: newRetryCount }
        );
        summary.dead_lettered += 1;

        summary.results.push({
          event_id: event.event_id,
          status: 'dead_letter',
          retry_attempt: newRetryCount,
          reason: deliveryResult?.reason || 'retries_exhausted'
        });
      } else {
        // Still retryable — bump count and set next_retry_at
        const backoffMs = this.delivery.calcBackoffMs(newRetryCount - 1);
        const nextRetryAt = new Date(Date.now() + backoffMs);

        await this.db.incrementRetryCount(event.event_id, nextRetryAt);
        summary.failed += 1;

        summary.results.push({
          event_id: event.event_id,
          status: 'retry_scheduled',
          retry_attempt: newRetryCount,
          next_retry_at: nextRetryAt.toISOString(),
          backoff_ms: backoffMs
        });
      }
    }

    // Audit log
    try {
      await this.db.logAgentAction(
        'scheduler-retry',
        null,
        null,
        'retry_cycle',
        null,
        'success',
        null,
        {
          found: summary.found,
          retried: summary.retried,
          delivered: summary.delivered,
          dead_lettered: summary.dead_lettered
        }
      );
    } catch (_e) { /* best-effort */ }

    return summary;
  }

  /**
   * Replay a single dead-letter event on-demand.
   * - success: mark dispatched
   * - failure: keep dead_letter and attach replay metadata
   */
  async replayDeadLetterEvent({ eventId, maxRetries } = {}) {
    if (!this.hasOutboxSupport() || typeof this.db.getOutboundEventById !== 'function') {
      return { ok: false, reason: 'outbox_replay_not_supported' };
    }

    const event = await this.db.getOutboundEventById(eventId);
    if (!event) {
      return { ok: false, reason: 'not_found', event_id: eventId };
    }

    if (event.status !== 'dead_letter') {
      return {
        ok: false,
        reason: 'not_dead_letter',
        event_id: eventId,
        current_status: event.status
      };
    }

    const envelope = event.payload || {};

    let deliveryResult;
    try {
      deliveryResult = await this.delivery.deliverWithRetry(envelope, {
        maxRetries: Number.isInteger(maxRetries) ? maxRetries : undefined
      });
    } catch (err) {
      deliveryResult = {
        delivered: false,
        mode: this.delivery?.mode || 'unknown',
        reason: err.message,
        exhausted: true
      };
    }

    if (deliveryResult?.delivered) {
      await this.db.markOutboundEventDispatched(eventId, {
        replay: {
          replayed: true,
          replayed_at: new Date().toISOString(),
          attempts: deliveryResult.attempts,
          retried: deliveryResult.retried,
          mode: deliveryResult.mode
        },
        delivery: deliveryResult
      });

      return {
        ok: true,
        event_id: eventId,
        status: 'dispatched',
        delivery: deliveryResult
      };
    }

    await this.db.markOutboundEventDeadLetter(
      eventId,
      deliveryResult?.reason || 'replay_failed',
      {
        replay: {
          replayed: true,
          replayed_at: new Date().toISOString(),
          attempts: deliveryResult?.attempts || 1,
          exhausted: !!deliveryResult?.exhausted
        },
        delivery: deliveryResult
      }
    );

    return {
      ok: false,
      event_id: eventId,
      status: 'dead_letter',
      reason: deliveryResult?.reason || 'replay_failed',
      delivery: deliveryResult
    };
  }

  async replayDeadLetterBatch({
    limit = 20,
    eventType = null,
    userId = null,
    olderThanMinutes = null,
    maxRetries
  } = {}) {
    if (!this.hasOutboxSupport() || typeof this.db.getDeadLetterEvents !== 'function') {
      return { ok: false, reason: 'dead_letter_batch_not_supported' };
    }

    const events = await this.db.getDeadLetterEvents({
      limit,
      eventType,
      userId,
      olderThanMinutes
    });

    const summary = {
      ok: true,
      filters: {
        limit,
        eventType,
        userId,
        olderThanMinutes: Number.isInteger(olderThanMinutes) ? olderThanMinutes : null
      },
      found: events.length,
      processed: 0,
      dispatched: 0,
      still_dead_letter: 0,
      failed: 0,
      results: []
    };

    for (const event of events) {
      const replay = await this.replayDeadLetterEvent({
        eventId: event.event_id,
        maxRetries
      });

      summary.processed += 1;

      if (replay.ok && replay.status === 'dispatched') {
        summary.dispatched += 1;
      } else if (replay.status === 'dead_letter') {
        summary.still_dead_letter += 1;
      } else {
        summary.failed += 1;
      }

      summary.results.push({
        event_id: event.event_id,
        event_type: event.event_type,
        user_id: event.user_id,
        status: replay.status || 'unknown',
        ok: !!replay.ok,
        reason: replay.reason || null,
        attempts: replay.delivery?.attempts ?? null
      });
    }

    try {
      await this.db.logAgentAction(
        'scheduler-replay',
        userId || null,
        null,
        'dead_letter_replay_bulk',
        null,
        'success',
        null,
        {
          filters: summary.filters,
          found: summary.found,
          processed: summary.processed,
          dispatched: summary.dispatched,
          still_dead_letter: summary.still_dead_letter,
          failed: summary.failed
        }
      );
    } catch (_e) {
      // best effort
    }

    return summary;
  }

  async runMorningCycle({ limitUsers = 100 } = {}) {
    const users = await this.db.listUserIds(limitUsers);

    const result = {
      targetedUsers: users.length,
      deliveredEvents: 0,
      deliveryFailures: 0,
      outboxQueued: 0,
      outboxDispatched: 0,
      outboxFailed: 0,
      messages: []
    };

    for (const userId of users) {
      const profile = await this.db.getUserProfile(userId);
      const message = this.intervention.buildMorningCheckIn({ profile: profile || {} });

      let deliveryResult = null;
      let outbox = null;

      if (this.deliverMorning) {
        const dispatch = await this.dispatchIntervention({
          userId,
          cycle: 'morning',
          message,
          severity: 'info',
          metadata: {
            profile_loaded: !!profile
          }
        });

        deliveryResult = dispatch.deliveryResult;
        outbox = dispatch.outbox;

        if (deliveryResult?.delivered) {
          result.deliveredEvents += 1;
        } else if (this.delivery.mode !== 'none') {
          result.deliveryFailures += 1;
        }

        if (outbox?.queued) result.outboxQueued += 1;
        if (outbox?.status === 'dispatched') result.outboxDispatched += 1;
        if (outbox?.status === 'failed' || outbox?.status === 'queue_failed') result.outboxFailed += 1;
      }

      await this.db.logAgentAction(
        'intervention',
        userId,
        null,
        'scheduled_morning_checkin',
        null,
        'success',
        null,
        {
          message_preview: message.slice(0, 120),
          delivery: deliveryResult,
          outbox
        }
      );

      result.messages.push({
        userId,
        message,
        delivered: !!deliveryResult?.delivered,
        outbox_event_id: outbox?.event_id || null,
        outbox_status: outbox?.status || null
      });
    }

    return result;
  }
}

module.exports = SchedulerRunner;
