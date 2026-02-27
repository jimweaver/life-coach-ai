class CanaryDriftDetector {
  constructor(options = {}) {
    this.warnRatio = Number(options.warnRatio ?? process.env.CANARY_DRIFT_WARN_RATIO ?? 0.25);
    this.criticalRatio = Number(options.criticalRatio ?? process.env.CANARY_DRIFT_CRITICAL_RATIO ?? 0.5);
    this.minSamples = Number(options.minSamples ?? process.env.CANARY_PROFILE_MIN_SAMPLES ?? 5);
  }

  ratioDelta(active, suggested) {
    const a = Number(active);
    const s = Number(suggested);

    if (!Number.isFinite(a) || !Number.isFinite(s) || s <= 0) return null;
    return Math.abs(a - s) / s;
  }

  evaluate({
    profile,
    activeThresholds,
    historyCount = 0,
    historyFile = null
  }) {
    const base = {
      ready: false,
      level: 'info',
      drift_detected: false,
      should_notify: false,
      reasons: [],
      config: {
        warn_ratio: this.warnRatio,
        critical_ratio: this.criticalRatio,
        min_samples: this.minSamples
      },
      active_thresholds: {
        max_error_rate: Number(activeThresholds?.max_error_rate ?? NaN),
        max_p95_ms: Number(activeThresholds?.max_p95_ms ?? NaN),
        max_avg_ms: Number(activeThresholds?.max_avg_ms ?? NaN)
      },
      suggested_thresholds: profile?.suggested_thresholds || null,
      profile: {
        ready: !!profile?.ready,
        sample_count: Number(profile?.sample_count || 0),
        reason: profile?.reason || null,
        history_count: Number(historyCount || 0),
        history_file: historyFile || null
      }
    };

    if (!profile?.ready || !profile?.suggested_thresholds) {
      if (Number(profile?.sample_count || 0) < this.minSamples) {
        base.reasons.push(`insufficient_samples:${profile?.sample_count || 0}/${this.minSamples}`);
      } else {
        base.reasons.push('profile_not_ready');
      }
      return base;
    }

    const comparisons = [
      {
        key: 'max_error_rate',
        active: base.active_thresholds.max_error_rate,
        suggested: Number(profile.suggested_thresholds.max_error_rate)
      },
      {
        key: 'max_p95_ms',
        active: base.active_thresholds.max_p95_ms,
        suggested: Number(profile.suggested_thresholds.max_p95_ms)
      },
      {
        key: 'max_avg_ms',
        active: base.active_thresholds.max_avg_ms,
        suggested: Number(profile.suggested_thresholds.max_avg_ms)
      }
    ];

    let level = 'info';
    const reasonList = [];

    for (const c of comparisons) {
      const ratio = this.ratioDelta(c.active, c.suggested);
      if (ratio === null) continue;

      if (ratio >= this.criticalRatio) {
        level = 'critical';
        reasonList.push(`${c.key}:ratio=${ratio.toFixed(3)}>=${this.criticalRatio}`);
      } else if (ratio >= this.warnRatio && level !== 'critical') {
        level = 'warn';
        reasonList.push(`${c.key}:ratio=${ratio.toFixed(3)}>=${this.warnRatio}`);
      }
    }

    if (reasonList.length === 0) {
      return {
        ...base,
        ready: true,
        level: 'info',
        drift_detected: false,
        should_notify: false,
        reasons: ['within_tolerance']
      };
    }

    return {
      ...base,
      ready: true,
      level,
      drift_detected: true,
      should_notify: true,
      reasons: reasonList
    };
  }
}

module.exports = CanaryDriftDetector;
