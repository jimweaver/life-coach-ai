#!/usr/bin/env node

/**
 * Test Prometheus metrics export endpoint
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchPrometheusMetrics() {
  const res = await fetch(`${API_BASE}/metrics/prometheus`);
  const text = await res.text();
  return { res, text };
}

async function run() {
  console.log('Testing Prometheus metrics export...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const { res, text } = await fetchPrometheusMetrics();
    assert(res.status === 200, 'should return 200');
    assert(res.headers.get('content-type').includes('text/plain'), 'should return text/plain');
    console.log('✅ Basic endpoint access works');

    // Test 2: Check for Prometheus format markers
    console.log('\nTest 2: Prometheus format markers...');
    assert(text.includes('# TYPE'), 'should include # TYPE');
    assert(text.includes('# HELP') || process.env.PROMETHEUS_HELP_TEXT === 'false', 'should include # HELP');
    assert(text.includes('lifecoach_'), 'should include lifecoach_ prefix');
    console.log('✅ Prometheus format markers present');

    // Test 3: Check for key metrics
    console.log('\nTest 3: Key metrics presence...');
    assert(text.includes('lifecoach_requests_total'), 'should include requests_total');
    assert(text.includes('lifecoach_memory_heap_used_bytes'), 'should include memory_heap_used_bytes');
    assert(text.includes('lifecoach_cache_hit_ratio'), 'should include cache_hit_ratio');
    console.log('✅ Key metrics present');

    // Test 4: Validate metric format
    console.log('\nTest 4: Metric format validation...');
    const lines = text.split('\n').filter(l => l && !l.startsWith('#'));
    assert(lines.length > 0, 'should have metric lines');
    
    // Check first metric line format: name{labels} value
    const metricLine = lines[0];
    const metricPattern = /^[a-z_]+({.*})?\s+\d+(\.\d+)?$/;
    assert(metricPattern.test(metricLine), `metric line should match pattern: ${metricLine}`);
    console.log('✅ Metric format valid');

    // Test 5: Check for histogram buckets
    console.log('\nTest 5: Histogram buckets...');
    assert(text.includes('lifecoach_request_latency_bucket'), 'should include latency buckets');
    assert(text.includes('le="0.1"'), 'should include 100ms bucket');
    assert(text.includes('le="+Inf"'), 'should include +Inf bucket');
    console.log('✅ Histogram buckets present');

    console.log('\n✅ All Prometheus metrics tests passed');
    console.log('\nSample output (first 10 lines):');
    console.log(text.split('\n').slice(0, 10).join('\n'));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
