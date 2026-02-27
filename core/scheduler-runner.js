const KBIMonitor = require('./kbi-monitor');
const InterventionEngine = require('./intervention-engine');

class SchedulerRunner {
  constructor(db) {
    this.db = db;
    this.kbiMonitor = new KBIMonitor();
    this.intervention = new InterventionEngine();
  }

  async runMonitorCycle({ limitUsers = 100 } = {}) {
    const users = await this.db.listUserIds(limitUsers);

    const summary = {
      scannedUsers: users.length,
      withData: 0,
      criticalUsers: 0,
      warnUsers: 0,
      interventions: 0,
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
          intervention_message: interventionMsg
        }
      );

      summary.results.push({
        userId,
        status: 'evaluated',
        overall: evaluation.overall,
        intervention: interventionMsg || null
      });
    }

    return summary;
  }

  async runMorningCycle({ limitUsers = 100 } = {}) {
    const users = await this.db.listUserIds(limitUsers);

    const result = {
      targetedUsers: users.length,
      messages: []
    };

    for (const userId of users) {
      const profile = await this.db.getUserProfile(userId);
      const message = this.intervention.buildMorningCheckIn({ profile: profile || {} });

      await this.db.logAgentAction(
        'intervention',
        userId,
        null,
        'scheduled_morning_checkin',
        null,
        'success',
        null,
        { message_preview: message.slice(0, 120) }
      );

      result.messages.push({ userId, message });
    }

    return result;
  }
}

module.exports = SchedulerRunner;
