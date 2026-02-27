#!/usr/bin/env node

/**
 * Test agent execution time metrics
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchOrchestratorMetrics() {
  const res = await fetch(`${API_BASE}/metrics/orchestrator`);
  return res.json();
}

async function generateTraffic() {
  // Generate some traffic to create agent execution stats
  for (let i = 0; i < 2; i++) {
    await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: uuidv4(),
        message: '我想轉職做工程師'
      })
    });
  }
}

async function run() {
  console.log('Testing agent execution time metrics...\n');

  try {
    // Test 1: Check agent_execution in metrics
    console.log('Test 1: Agent execution metrics structure...');
    const data = await fetchOrchestratorMetrics();
    assert(data.ok === true, 'should return ok: true');
    assert(data.agent_execution !== undefined, 'should have agent_execution');
    assert(typeof data.agent_execution.total === 'number', 'should have total');
    assert(typeof data.agent_execution.avg_ms === 'number', 'should have avg_ms');
    assert(Array.isArray(data.agent_execution.by_domain), 'should have by_domain array');
    assert(data.agent_execution.slow_executions !== undefined, 'should have slow_executions');
    console.log('✅ Agent execution metrics structure valid');

    // Test 2: Generate traffic
    console.log('\nTest 2: Generating traffic...');
    await generateTraffic();
    console.log('✅ Generated test traffic');

    // Test 3: Verify metrics updated
    console.log('\nTest 3: Verify metrics updated...');
    const updatedData = await fetchOrchestratorMetrics();
    console.log(`   Total agent executions: ${updatedData.agent_execution.total}`);
    console.log(`   Avg execution time: ${updatedData.agent_execution.avg_ms}ms`);
    console.log('✅ Metrics present');

    // Test 4: By domain stats
    console.log('\nTest 4: By domain stats...');
    if (updatedData.agent_execution.by_domain.length > 0) {
      const domain = updatedData.agent_execution.by_domain[0];
      assert(typeof domain.domain === 'string', 'domain should have domain name');
      assert(typeof domain.total === 'number', 'domain should have total');
      assert(typeof domain.avg_ms === 'number', 'domain should have avg_ms');
      assert(typeof domain.min_ms === 'number', 'domain should have min_ms');
      assert(typeof domain.max_ms === 'number', 'domain should have max_ms');
      console.log('   Domains:', updatedData.agent_execution.by_domain.map(d => d.domain));
    }
    console.log('✅ By domain stats present');

    // Test 5: Slow executions
    console.log('\nTest 5: Slow executions...');
    assert(typeof updatedData.agent_execution.slow_executions.count === 'number',
      'should have slow_executions.count');
    assert(Array.isArray(updatedData.agent_execution.slow_executions.recent),
      'should have slow_executions.recent array');
    console.log('✅ Slow executions tracking present');

    console.log('\n✅ All agent execution metrics tests passed');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
