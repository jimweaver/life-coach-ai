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
