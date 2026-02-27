class AlertOwnershipDriftDetector {
  constructor(options = {}) {
    this.warnStaleMinutes = Number(options.warnStaleMinutes ?? process.env.ALERT_OWNER_DRIFT_WARN_STALE_MINUTES ?? 120);
    this.criticalStaleMinutes = Number(options.criticalStaleMinutes ?? process.env.ALERT_OWNER_DRIFT_CRITICAL_STALE_MINUTES ?? 360);
    this.strict = options.strict ?? String(process.env.ALERT_OWNER_DRIFT_STRICT || 'false').toLowerCase() === 'true';
  }

  computeDrift(policy = {}) {
    const sync = policy?.oncall_sync || {};

    const assigned = sync.assigned || {};
    const stale = !!sync.stale;
    const enabled = !!sync.enabled;

    const nowMs = Date.now();
    const lastSyncMs = sync.last_sync_at ? Date.parse(sync.last_sync_at) : 0;
    const ageMinutes = lastSyncMs > 0
      ? Math.max(0, Math.round((nowMs - lastSyncMs) / 60000))
      : null;

    const reasons = [];

    if (enabled && stale) {
      reasons.push('oncall_sync_stale');
    }

    if (enabled && sync.error) {
      reasons.push('oncall_sync_error');
    }

    if (enabled && !assigned.warn?.user_id) {
      reasons.push('missing_warn_owner');
    }

    if (enabled && !assigned.critical?.user_id) {
      reasons.push('missing_critical_owner');
    }

    if (policy.escalation_enabled && !assigned.escalation?.user_id && !policy.escalation_user_id) {
      reasons.push('missing_escalation_owner');
    }

    if (enabled && ageMinutes !== null && ageMinutes >= this.criticalStaleMinutes) {
      reasons.push(`sync_age_exceeds_critical_${this.criticalStaleMinutes}m`);
    } else if (enabled && ageMinutes !== null && ageMinutes >= this.warnStaleMinutes) {
      reasons.push(`sync_age_exceeds_warn_${this.warnStaleMinutes}m`);
    }

    let level = 'ok';

    const hasCriticalAge = reasons.some((r) => r.includes('critical'));
    const hasStructuralGap = reasons.some((r) => r.startsWith('missing_'));
    const hasStaleOrError = reasons.some((r) => r.includes('stale') || r.includes('error'));

    if (hasCriticalAge || (this.strict && hasStructuralGap) || (hasStructuralGap && hasStaleOrError)) {
      level = 'critical';
    } else if (reasons.length > 0) {
      level = 'warn';
    }

    return {
      level,
      drift_detected: reasons.length > 0,
      reasons,
      sync: {
        enabled,
        stale,
        error: sync.error || null,
        last_sync_at: sync.last_sync_at || null,
        age_minutes: ageMinutes
      },
      owners: {
        warn: assigned.warn || null,
        critical: assigned.critical || null,
        escalation: assigned.escalation || null
      },
      policy_snapshot: {
        route_strategy: policy.route_strategy || null,
        escalation_enabled: !!policy.escalation_enabled
      }
    };
  }
}

module.exports = AlertOwnershipDriftDetector;
