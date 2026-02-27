#!/usr/bin/env node

/**
 * Test metrics alert evaluation endpoint
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchMetricsAlerts() {
  const res = await fetch(`${API_BASE}/metrics/alerts`);
  return res.json();
}

async function run() {
  console.log('Testing metrics alert evaluation...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchMetricsAlerts();
    assert(data.ok === true, 'should return ok: true');
    assert(Array.isArray(data.alerts), 'should have alerts array');
    assert(typeof data.alert_count === 'number', 'should have alert_count');
    assert(typeof data.has_critical === 'boolean', 'should have has_critical');
    console.log('✅ Basic endpoint access works');

    // Test 2: Thresholds configuration
    console.log('\nTest 2: Thresholds configuration...');
    assert(data.thresholds !== undefined, 'should have thresholds');
    assert(data.thresholds.latency !== undefined, 'should have latency thresholds');
    assert(data.thresholds.error_rate !== undefined, 'should have error_rate thresholds');
    assert(data.thresholds.memory !== undefined, 'should have memory thresholds');
    assert(data.thresholds.cache_hit_rate !== undefined, 'should have cache_hit_rate thresholds');
    assert(data.thresholds.delivery_success !== undefined, 'should have delivery_success thresholds');
    assert(data.thresholds.model_success !== undefined, 'should have model_success thresholds');
    console.log('   Latency warn:', data.thresholds.latency.warn, 'ms');
    console.log('   Error rate warn:', data.thresholds.error_rate.warn * 100, '%');
    console.log('   Memory warn:', data.thresholds.memory.warn * 100, '%');
    console.log('✅ Thresholds configuration present');

    // Test 3: Alert structure (if any alerts)
    console.log('\nTest 3: Alert structure...');
    console.log('   Alert count:', data.alert_count);
    if (data.alerts.length > 0) {
      const alert = data.alerts[0];
      assert(['warn', 'critical'].includes(alert.level), 'alert should have valid level');
      assert(typeof alert.metric === 'string', 'alert should have metric');
      assert(typeof alert.value !== 'undefined', 'alert should have value');
      assert(typeof alert.threshold !== 'undefined', 'alert should have threshold');
      assert(typeof alert.message === 'string', 'alert should have message');
      console.log('   Sample alert:', alert.message);
    }
    console.log('✅ Alert structure valid');

    // Test 4: Timestamp
    console.log('\nTest 4: Timestamp...');
    assert(typeof data.evaluated_at === 'string', 'should have evaluated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All metrics alerts tests passed');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
