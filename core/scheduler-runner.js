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
      if (interventionMsg && this.deliverMonitor) {
        const envelope = this.delivery.buildEnvelope({
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

        deliveryResult = await this.delivery.deliver(envelope);

        if (deliveryResult.delivered) {
          summary.deliveredEvents += 1;
        } else if (this.delivery.mode !== 'none') {
          summary.deliveryFailures += 1;
        }
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
          delivery: deliveryResult
        }
      );

      summary.results.push({
        userId,
        status: 'evaluated',
        overall: evaluation.overall,
        intervention: interventionMsg || null,
        delivered: !!deliveryResult?.delivered
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
      messages: []
    };

    for (const userId of users) {
      const profile = await this.db.getUserProfile(userId);
      const message = this.intervention.buildMorningCheckIn({ profile: profile || {} });

      let deliveryResult = null;
      if (this.deliverMorning) {
        const envelope = this.delivery.buildEnvelope({
          userId,
          cycle: 'morning',
          message,
          severity: 'info',
          metadata: {
            profile_loaded: !!profile
          }
        });

        deliveryResult = await this.delivery.deliver(envelope);

        if (deliveryResult.delivered) {
          result.deliveredEvents += 1;
        } else if (this.delivery.mode !== 'none') {
          result.deliveryFailures += 1;
        }
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
          delivery: deliveryResult
        }
      );

      result.messages.push({
        userId,
        message,
        delivered: !!deliveryResult?.delivered
      });
    }

    return result;
  }
}

module.exports = SchedulerRunner;
