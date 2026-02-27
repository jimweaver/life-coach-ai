#!/usr/bin/env node

/**
 * Metrics alerting threshold evaluator
 * Monitors metrics and triggers alerts when thresholds are breached
 */

class MetricsAlertEvaluator {
  constructor(options = {}) {
    // Latency thresholds (ms)
    this.latencyThresholds = {
      warn: Number(options.latencyWarnMs ?? process.env.METRICS_ALERT_LATENCY_WARN_MS ?? 1000),
      critical: Number(options.latencyCriticalMs ?? process.env.METRICS_ALERT_LATENCY_CRITICAL_MS ?? 3000)
    };

    // Error rate thresholds (0-1)
    this.errorRateThresholds = {
      warn: Number(options.errorRateWarn ?? process.env.METRICS_ALERT_ERROR_RATE_WARN ?? 0.05),
      critical: Number(options.errorRateCritical ?? process.env.METRICS_ALERT_ERROR_RATE_CRITICAL ?? 0.10)
    };

    // Memory thresholds (0-1 ratio)
    this.memoryThresholds = {
      warn: Number(options.memoryWarn ?? process.env.METRICS_ALERT_MEMORY_WARN ?? 0.80),
      critical: Number(options.memoryCritical ?? process.env.METRICS_ALERT_MEMORY_CRITICAL ?? 0.95)
    };

    // Cache hit rate thresholds (0-1)
    this.cacheHitRateThresholds = {
      warn: Number(options.cacheHitRateWarn ?? process.env.METRICS_ALERT_CACHE_HIT_RATE_WARN ?? 0.70),
      critical: Number(options.cacheHitRateCritical ?? process.env.METRICS_ALERT_CACHE_HIT_RATE_CRITICAL ?? 0.50)
    };

    // Delivery success rate thresholds (0-1)
    this.deliverySuccessThresholds = {
      warn: Number(options.deliverySuccessWarn ?? process.env.METRICS_ALERT_DELIVERY_SUCCESS_WARN ?? 0.90),
      critical: Number(options.deliverySuccessCritical ?? process.env.METRICS_ALERT_DELIVERY_SUCCESS_CRITICAL ?? 0.80)
    };

    // Model success rate thresholds (0-1)
    this.modelSuccessThresholds = {
      warn: Number(options.modelSuccessWarn ?? process.env.METRICS_ALERT_MODEL_SUCCESS_WARN ?? 0.90),
      critical: Number(options.modelSuccessCritical ?? process.env.METRICS_ALERT_MODEL_SUCCESS_CRITICAL ?? 0.80)
    };

    // Minimum sample size to avoid false positives
    this.minSampleSize = Number(options.minSampleSize ?? process.env.METRICS_ALERT_MIN_SAMPLE_SIZE ?? 10);

    // Cooldown between alerts (minutes)
    this.cooldownMinutes = Number(options.cooldownMinutes ?? process.env.METRICS_ALERT_COOLDOWN_MINUTES ?? 15);

    // Track last alert times
    this.lastAlerts = new Map();
  }

  /**
   * Check if enough time has passed since last alert
   */
  isCooldownExpired(alertKey) {
    const lastAlert = this.lastAlerts.get(alertKey);
    if (!lastAlert) return true;

    const cooldownMs = this.cooldownMinutes * 60 * 1000;
    return Date.now() - lastAlert > cooldownMs;
  }

  /**
   * Record an alert was sent
   */
  recordAlert(alertKey) {
    this.lastAlerts.set(alertKey, Date.now());
  }

  /**
   * Evaluate latency metrics
   */
  evaluateLatency(avgLatencyMs, totalRequests) {
    if (totalRequests < this.minSampleSize) return null;

    if (avgLatencyMs >= this.latencyThresholds.critical) {
      return {
        level: 'critical',
        metric: 'latency',
        value: avgLatencyMs,
        threshold: this.latencyThresholds.critical,
        message: `Average latency ${avgLatencyMs}ms exceeds critical threshold ${this.latencyThresholds.critical}ms`
      };
    }

    if (avgLatencyMs >= this.latencyThresholds.warn) {
      return {
        level: 'warn',
        metric: 'latency',
        value: avgLatencyMs,
        threshold: this.latencyThresholds.warn,
        message: `Average latency ${avgLatencyMs}ms exceeds warning threshold ${this.latencyThresholds.warn}ms`
      };
    }

    return null;
  }

  /**
   * Evaluate error rate metrics
   */
  evaluateErrorRate(errorRate, totalRequests) {
    if (totalRequests < this.minSampleSize) return null;

    // Parse error rate string (e.g., "5.50%") to number
    const rate = typeof errorRate === 'string'
      ? parseFloat(errorRate.replace('%', '')) / 100
      : errorRate;

    if (rate >= this.errorRateThresholds.critical) {
      return {
        level: 'critical',
        metric: 'error_rate',
        value: rate,
        threshold: this.errorRateThresholds.critical,
        message: `Error rate ${(rate * 100).toFixed(2)}% exceeds critical threshold ${(this.errorRateThresholds.critical * 100).toFixed(0)}%`
      };
    }

    if (rate >= this.errorRateThresholds.warn) {
      return {
        level: 'warn',
        metric: 'error_rate',
        value: rate,
        threshold: this.errorRateThresholds.warn,
        message: `Error rate ${(rate * 100).toFixed(2)}% exceeds warning threshold ${(this.errorRateThresholds.warn * 100).toFixed(0)}%`
      };
    }

    return null;
  }

  /**
   * Evaluate memory metrics
   */
  evaluateMemory(heapUtilizationRatio) {
    if (heapUtilizationRatio >= this.memoryThresholds.critical) {
      return {
        level: 'critical',
        metric: 'memory',
        value: heapUtilizationRatio,
        threshold: this.memoryThresholds.critical,
        message: `Heap utilization ${(heapUtilizationRatio * 100).toFixed(1)}% exceeds critical threshold ${(this.memoryThresholds.critical * 100).toFixed(0)}%`
      };
    }

    if (heapUtilizationRatio >= this.memoryThresholds.warn) {
      return {
        level: 'warn',
        metric: 'memory',
        value: heapUtilizationRatio,
        threshold: this.memoryThresholds.warn,
        message: `Heap utilization ${(heapUtilizationRatio * 100).toFixed(1)}% exceeds warning threshold ${(this.memoryThresholds.warn * 100).toFixed(0)}%`
      };
    }

    return null;
  }

  /**
   * Evaluate cache hit rate
   */
  evaluateCacheHitRate(hitRate) {
    // Parse hit rate string (e.g., "85.00%") to number
    const rate = typeof hitRate === 'string'
      ? parseFloat(hitRate.replace('%', '')) / 100
      : hitRate;

    if (rate <= this.cacheHitRateThresholds.critical) {
      return {
        level: 'critical',
        metric: 'cache_hit_rate',
        value: rate,
        threshold: this.cacheHitRateThresholds.critical,
        message: `Cache hit rate ${(rate * 100).toFixed(1)}% below critical threshold ${(this.cacheHitRateThresholds.critical * 100).toFixed(0)}%`
      };
    }

    if (rate <= this.cacheHitRateThresholds.warn) {
      return {
        level: 'warn',
        metric: 'cache_hit_rate',
        value: rate,
        threshold: this.cacheHitRateThresholds.warn,
        message: `Cache hit rate ${(rate * 100).toFixed(1)}% below warning threshold ${(this.cacheHitRateThresholds.warn * 100).toFixed(0)}%`
      };
    }

    return null;
  }

  /**
   * Evaluate delivery success rate
   */
  evaluateDeliverySuccess(successRate) {
    // Parse success rate string (e.g., "95.00%") to number
    const rate = typeof successRate === 'string'
      ? parseFloat(successRate.replace('%', '')) / 100
      : successRate;

    if (rate <= this.deliverySuccessThresholds.critical) {
      return {
        level: 'critical',
        metric: 'delivery_success',
        value: rate,
        threshold: this.deliverySuccessThresholds.critical,
        message: `Delivery success rate ${(rate * 100).toFixed(1)}% below critical threshold ${(this.deliverySuccessThresholds.critical * 100).toFixed(0)}%`
      };
    }

    if (rate <= this.deliverySuccessThresholds.warn) {
      return {
        level: 'warn',
        metric: 'delivery_success',
        value: rate,
        threshold: this.deliverySuccessThresholds.warn,
        message: `Delivery success rate ${(rate * 100).toFixed(1)}% below warning threshold ${(this.deliverySuccessThresholds.warn * 100).toFixed(0)}%`
      };
    }

    return null;
  }

  /**
   * Evaluate model success rate
   */
  evaluateModelSuccess(successRate) {
    // Parse success rate string (e.g., "95.00%") to number
    const rate = typeof successRate === 'string'
      ? parseFloat(successRate.replace('%', '')) / 100
      : successRate;

    if (rate <= this.modelSuccessThresholds.critical) {
      return {
        level: 'critical',
        metric: 'model_success',
        value: rate,
        threshold: this.modelSuccessThresholds.critical,
        message: `Model success rate ${(rate * 100).toFixed(1)}% below critical threshold ${(this.modelSuccessThresholds.critical * 100).toFixed(0)}%`
      };
    }

    if (rate <= this.modelSuccessThresholds.warn) {
      return {
        level: 'warn',
        metric: 'model_success',
        value: rate,
        threshold: this.modelSuccessThresholds.warn,
        message: `Model success rate ${(rate * 100).toFixed(1)}% below warning threshold ${(this.modelSuccessThresholds.warn * 100).toFixed(0)}%`
      };
    }

    return null;
  }

  /**
   * Evaluate all metrics and return alerts
   */
  evaluateAll(metrics) {
    const alerts = [];

    // Evaluate orchestrator metrics
    if (metrics.orchestrator) {
      const latencyAlert = this.evaluateLatency(
        metrics.orchestrator.latency?.average_ms,
        metrics.orchestrator.requests?.total
      );
      if (latencyAlert && this.isCooldownExpired('latency')) {
        this.recordAlert('latency');
        alerts.push(latencyAlert);
      }

      const errorAlert = this.evaluateErrorRate(
        metrics.orchestrator.errors?.rate,
        metrics.orchestrator.requests?.total
      );
      if (errorAlert && this.isCooldownExpired('error_rate')) {
        this.recordAlert('error_rate');
        alerts.push(errorAlert);
      }
    }

    // Evaluate memory metrics
    if (metrics.memory) {
      const memoryAlert = this.evaluateMemory(metrics.memory.heap_utilization_percent / 100);
      if (memoryAlert && this.isCooldownExpired('memory')) {
        this.recordAlert('memory');
        alerts.push(memoryAlert);
      }
    }

    // Evaluate cache metrics
    if (metrics.cache) {
      const cacheAlert = this.evaluateCacheHitRate(metrics.cache.hit_rate);
      if (cacheAlert && this.isCooldownExpired('cache_hit_rate')) {
        this.recordAlert('cache_hit_rate');
        alerts.push(cacheAlert);
      }
    }

    // Evaluate delivery metrics
    if (metrics.delivery) {
      const deliveryAlert = this.evaluateDeliverySuccess(metrics.delivery.success_rate);
      if (deliveryAlert && this.isCooldownExpired('delivery_success')) {
        this.recordAlert('delivery_success');
        alerts.push(deliveryAlert);
      }
    }

    // Evaluate model metrics
    if (metrics.model) {
      const modelAlert = this.evaluateModelSuccess(metrics.model.success_rate);
      if (modelAlert && this.isCooldownExpired('model_success')) {
        this.recordAlert('model_success');
        alerts.push(modelAlert);
      }
    }

    return {
      alerts,
      alert_count: alerts.length,
      has_critical: alerts.some(a => a.level === 'critical'),
      evaluated_at: new Date().toISOString()
    };
  }

  /**
   * Get current threshold configuration
   */
  getConfig() {
    return {
      latency: this.latencyThresholds,
      error_rate: this.errorRateThresholds,
      memory: this.memoryThresholds,
      cache_hit_rate: this.cacheHitRateThresholds,
      delivery_success: this.deliverySuccessThresholds,
      model_success: this.modelSuccessThresholds,
      min_sample_size: this.minSampleSize,
      cooldown_minutes: this.cooldownMinutes
    };
  }
}

module.exports = MetricsAlertEvaluator;
