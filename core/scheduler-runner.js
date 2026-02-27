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
  }

  hasOutboxSupport() {
    return Boolean(
      this.db
      && typeof this.db.enqueueOutboundEvent === 'function'
      && typeof this.db.markOutboundEventDispatched === 'function'
      && typeof this.db.markOutboundEventFailed === 'function'
    );
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
