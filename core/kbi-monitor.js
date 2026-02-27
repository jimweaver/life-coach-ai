class KBIMonitor {
  constructor() {
    this.thresholds = {
      goal_adherence: { warn: 0.6, critical: 0.4, higherIsBetter: true },
      engagement_score: { warn: 3, critical: 1, higherIsBetter: true },
      mood_trend: { warn: 3.2, critical: 2.5, higherIsBetter: true },
      skill_progress: { warn: 0.2, critical: 0.05, higherIsBetter: true }
    };
  }

  classify(metricName, value) {
    const t = this.thresholds[metricName];
    if (!t) return { level: 'info', reason: 'unknown metric' };

    if (t.higherIsBetter) {
      if (value <= t.critical) return { level: 'critical', reason: `${metricName} below critical` };
      if (value <= t.warn) return { level: 'warn', reason: `${metricName} below warning` };
      return { level: 'info', reason: `${metricName} healthy` };
    }

    // lower-is-better branch (future)
    if (value >= t.critical) return { level: 'critical', reason: `${metricName} above critical` };
    if (value >= t.warn) return { level: 'warn', reason: `${metricName} above warning` };
    return { level: 'info', reason: `${metricName} healthy` };
  }

  evaluateSnapshot(snapshot = {}) {
    const alerts = [];

    for (const [metric, value] of Object.entries(snapshot)) {
      const c = this.classify(metric, Number(value));
      alerts.push({ metric, value: Number(value), level: c.level, reason: c.reason });
    }

    const severityOrder = { info: 1, warn: 2, critical: 3 };
    const top = alerts.reduce((best, a) => (severityOrder[a.level] > severityOrder[best.level] ? a : best), { level: 'info' });

    return {
      overall: top.level,
      alerts,
      hasCritical: alerts.some(a => a.level === 'critical'),
      hasWarn: alerts.some(a => a.level === 'warn')
    };
  }
}

module.exports = KBIMonitor;
