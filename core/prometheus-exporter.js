#!/usr/bin/env node

/**
 * Prometheus metrics exporter
 * Converts internal metrics to Prometheus exposition format
 */

class PrometheusExporter {
  constructor(options = {}) {
    this.prefix = options.prefix || 'lifecoach';
    this.helpText = options.helpText !== false;
  }

  /**
   * Escape special characters in label values
   */
  escapeLabelValue(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /**
   * Format a metric line
   */
  formatMetric(name, value, labels = {}, timestamp = null) {
    const labelPairs = Object.entries(labels)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}="${this.escapeLabelValue(v)}"`);

    const labelStr = labelPairs.length > 0 ? `{${labelPairs.join(',')}}` : '';
    const ts = timestamp ? ` ${timestamp}` : '';

    return `${this.prefix}_${name}${labelStr} ${value}${ts}`;
  }

  /**
   * Generate HELP and TYPE lines
   */
  formatMetadata(name, type, help) {
    const lines = [];
    if (this.helpText && help) {
      lines.push(`# HELP ${this.prefix}_${name} ${help}`);
    }
    lines.push(`# TYPE ${this.prefix}_${name} ${type}`);
    return lines.join('\n');
  }

  /**
   * Convert orchestrator metrics to Prometheus format
   */
  exportOrchestratorMetrics(metrics) {
    const lines = [];

    // Uptime
    lines.push(this.formatMetadata('uptime_seconds', 'gauge', 'System uptime in seconds'));
    lines.push(this.formatMetric('uptime_seconds', Math.round(metrics.uptime_ms / 1000)));

    // Request counts
    lines.push(this.formatMetadata('requests_total', 'counter', 'Total requests processed'));
    lines.push(this.formatMetric('requests_total', metrics.requests.total));

    // Requests by mode
    if (metrics.requests.by_mode) {
      Object.entries(metrics.requests.by_mode).forEach(([mode, count]) => {
        lines.push(this.formatMetric('requests_total', count, { mode }));
      });
    }

    // Requests by domain
    if (metrics.requests.by_domain) {
      Object.entries(metrics.requests.by_domain).forEach(([domain, count]) => {
        lines.push(this.formatMetric('requests_total', count, { domain }));
      });
    }

    // Latency histogram
    lines.push(this.formatMetadata('request_latency_bucket', 'histogram', 'Request latency distribution'));
    const latencyBuckets = [
      ['le', '0.1'], ['le', '0.5'], ['le', '1.0'], ['le', '2.0'], ['le', '+Inf']
    ];
    const latencyCounts = [
      metrics.latency.histogram.under100,
      metrics.latency.histogram.under100 + metrics.latency.histogram.under500,
      metrics.latency.histogram.under100 + metrics.latency.histogram.under500 + metrics.latency.histogram.under1000,
      metrics.latency.histogram.under100 + metrics.latency.histogram.under500 + metrics.latency.histogram.under1000 + metrics.latency.histogram.under2000,
      metrics.latency.count
    ];
    latencyBuckets.forEach((bucket, i) => {
      lines.push(this.formatMetric('request_latency_bucket', latencyCounts[i], { bucket: bucket[1] }));
    });
    lines.push(this.formatMetric('request_latency_sum', metrics.latency.totalMs));
    lines.push(this.formatMetric('request_latency_count', metrics.latency.count));

    // Average latency
    lines.push(this.formatMetadata('request_latency_avg_ms', 'gauge', 'Average request latency in milliseconds'));
    lines.push(this.formatMetric('request_latency_avg_ms', metrics.latency.average_ms));

    // Error counts
    lines.push(this.formatMetadata('errors_total', 'counter', 'Total errors'));
    lines.push(this.formatMetric('errors_total', metrics.errors.total));

    // Errors by type
    if (metrics.errors.by_type) {
      Object.entries(metrics.errors.by_type).forEach(([type, count]) => {
        lines.push(this.formatMetric('errors_total', count, { type }));
      });
    }

    // Agent execution metrics
    if (metrics.agent_execution) {
      lines.push(this.formatMetadata('agent_executions_total', 'counter', 'Total agent executions'));
      lines.push(this.formatMetric('agent_executions_total', metrics.agent_execution.total));

      lines.push(this.formatMetadata('agent_execution_avg_ms', 'gauge', 'Average agent execution time in milliseconds'));
      lines.push(this.formatMetric('agent_execution_avg_ms', metrics.agent_execution.avg_ms));

      // By domain
      if (metrics.agent_execution.by_domain) {
        metrics.agent_execution.by_domain.forEach((domain) => {
          lines.push(this.formatMetric('agent_executions_total', domain.total, { domain: domain.domain }));
          lines.push(this.formatMetric('agent_execution_avg_ms', domain.avg_ms, { domain: domain.domain }));
        });
      }
    }

    return lines.join('\n');
  }

  /**
   * Convert memory metrics to Prometheus format
   */
  exportMemoryMetrics(metrics) {
    const lines = [];

    lines.push(this.formatMetadata('memory_heap_used_bytes', 'gauge', 'Heap memory used in bytes'));
    lines.push(this.formatMetric('memory_heap_used_bytes', Math.round(metrics.heap_used_mb * 1024 * 1024)));

    lines.push(this.formatMetadata('memory_heap_total_bytes', 'gauge', 'Total heap memory in bytes'));
    lines.push(this.formatMetric('memory_heap_total_bytes', Math.round(metrics.heap_total_mb * 1024 * 1024)));

    lines.push(this.formatMetadata('memory_rss_bytes', 'gauge', 'Resident set size in bytes'));
    lines.push(this.formatMetric('memory_rss_bytes', Math.round(metrics.rss_mb * 1024 * 1024)));

    lines.push(this.formatMetadata('memory_heap_utilization_ratio', 'gauge', 'Heap utilization ratio (0-1)'));
    lines.push(this.formatMetric('memory_heap_utilization_ratio', metrics.heap_utilization_percent / 100));

    return lines.join('\n');
  }

  /**
   * Convert cache metrics to Prometheus format
   */
  exportCacheMetrics(metrics) {
    const lines = [];

    lines.push(this.formatMetadata('cache_operations_total', 'counter', 'Total cache operations'));
    lines.push(this.formatMetric('cache_operations_total', metrics.hits, { operation: 'hit' }));
    lines.push(this.formatMetric('cache_operations_total', metrics.misses, { operation: 'miss' }));
    lines.push(this.formatMetric('cache_operations_total', metrics.sets, { operation: 'set' }));
    lines.push(this.formatMetric('cache_operations_total', metrics.deletes, { operation: 'delete' }));

    lines.push(this.formatMetadata('cache_hit_ratio', 'gauge', 'Cache hit ratio (0-1)'));
    const hitRatio = metrics.hits + metrics.misses > 0
      ? metrics.hits / (metrics.hits + metrics.misses)
      : 0;
    lines.push(this.formatMetric('cache_hit_ratio', hitRatio));

    return lines.join('\n');
  }

  /**
   * Convert delivery metrics to Prometheus format
   */
  exportDeliveryMetrics(metrics) {
    const lines = [];

    lines.push(this.formatMetadata('deliveries_total', 'counter', 'Total delivery attempts'));
    lines.push(this.formatMetric('deliveries_total', metrics.total_deliveries));

    lines.push(this.formatMetadata('delivery_success_total', 'counter', 'Successful deliveries'));
    lines.push(this.formatMetric('delivery_success_total', metrics.successful));

    lines.push(this.formatMetadata('delivery_failure_total', 'counter', 'Failed deliveries'));
    lines.push(this.formatMetric('delivery_failure_total', metrics.failed));

    lines.push(this.formatMetadata('delivery_success_ratio', 'gauge', 'Delivery success ratio (0-1)'));
    const successRatio = metrics.total_deliveries > 0
      ? metrics.successful / metrics.total_deliveries
      : 0;
    lines.push(this.formatMetric('delivery_success_ratio', successRatio));

    lines.push(this.formatMetadata('delivery_response_time_ms', 'gauge', 'Delivery response time in milliseconds'));
    lines.push(this.formatMetric('delivery_response_time_ms', metrics.response_time_ms.avg));

    return lines.join('\n');
  }

  /**
   * Convert model metrics to Prometheus format
   */
  exportModelMetrics(metrics) {
    const lines = [];

    lines.push(this.formatMetadata('model_calls_total', 'counter', 'Total model calls'));
    lines.push(this.formatMetric('model_calls_total', metrics.total_calls));

    lines.push(this.formatMetadata('model_call_success_total', 'counter', 'Successful model calls'));
    lines.push(this.formatMetric('model_call_success_total', metrics.successful));

    lines.push(this.formatMetadata('model_call_failure_total', 'counter', 'Failed model calls'));
    lines.push(this.formatMetric('model_call_failure_total', metrics.failed));

    lines.push(this.formatMetadata('model_call_duration_ms', 'gauge', 'Average model call duration in milliseconds'));
    lines.push(this.formatMetric('model_call_duration_ms', metrics.avg_duration_ms));

    // By model
    if (metrics.by_model) {
      metrics.by_model.forEach((model) => {
        lines.push(this.formatMetric('model_calls_total', model.total, { model: model.model }));
        lines.push(this.formatMetric('model_call_duration_ms', model.avg_ms, { model: model.model }));
      });
    }

    return lines.join('\n');
  }

  /**
   * Export all metrics in Prometheus format
   */
  exportAll(metrics) {
    const sections = [];

    // Add timestamp comment
    sections.push(`# Generated at ${new Date().toISOString()}`);
    sections.push('');

    // Orchestrator metrics
    if (metrics.orchestrator) {
      sections.push(this.exportOrchestratorMetrics(metrics.orchestrator));
      sections.push('');
    }

    // Memory metrics
    if (metrics.memory) {
      sections.push(this.exportMemoryMetrics(metrics.memory));
      sections.push('');
    }

    // Cache metrics
    if (metrics.cache) {
      sections.push(this.exportCacheMetrics(metrics.cache));
      sections.push('');
    }

    // Delivery metrics
    if (metrics.delivery) {
      sections.push(this.exportDeliveryMetrics(metrics.delivery));
      sections.push('');
    }

    // Model metrics
    if (metrics.model) {
      sections.push(this.exportModelMetrics(metrics.model));
      sections.push('');
    }

    return sections.join('\n');
  }
}

module.exports = PrometheusExporter;
