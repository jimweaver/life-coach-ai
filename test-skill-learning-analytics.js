#!/usr/bin/env node

/**
 * Test skill-learning analytics endpoint
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchAnalytics(days = 7) {
  const res = await fetch(`${API_BASE}/analytics/skill-learning?days=${days}`);
  return res.json();
}

async function run() {
  console.log('Testing skill-learning analytics endpoint...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchAnalytics();
    assert(data.ok === true, 'should return ok: true');
    assert(data.period?.days === 7, 'should default to 7 days');
    assert(data.summary !== undefined, 'should have summary');
    assert(Array.isArray(data.summary.daily_interactions), 'should have daily_interactions array');
    assert(Array.isArray(data.summary.top_keywords), 'should have top_keywords array');
    console.log('✅ Basic endpoint access works');

    // Test 2: Custom days parameter
    console.log('\nTest 2: Custom days parameter...');
    const data14 = await fetchAnalytics(14);
    assert(data14.period?.days === 14, 'should accept custom days');
    console.log('✅ Custom days parameter works');

    // Test 3: Days clamping (max 30)
    console.log('\nTest 3: Days clamping...');
    const data100 = await fetchAnalytics(100);
    assert(data100.period?.days === 30, 'should clamp days to max 30');
    console.log('✅ Days clamping works');

    // Test 4: Days minimum (1)
    console.log('\nTest 4: Days minimum...');
    const data0 = await fetchAnalytics(0);
    assert(data0.period?.days === 1, 'should enforce minimum 1 day');
    console.log('✅ Days minimum works');

    // Test 5: Response structure
    console.log('\nTest 5: Response structure...');
    assert(typeof data.summary.total_skill_learning_interactions === 'number', 'should have total count');
    assert(typeof data.generated_at === 'string', 'should have generated_at timestamp');
    console.log('✅ Response structure valid');

    console.log('\n✅ All skill-learning analytics tests passed');
    console.log('\nSample response:');
    console.log(JSON.stringify(data.summary, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
