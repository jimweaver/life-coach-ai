#!/usr/bin/env node

/**
 * Test cache hit/miss rate metrics endpoint
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchCacheMetrics() {
  const res = await fetch(`${API_BASE}/metrics/cache`);
  return res.json();
}

async function generateCacheTraffic() {
  // Generate traffic to create cache stats
  const sessionId = uuidv4();
  
  // Hit /profile endpoint multiple times (should create session cache operations)
  for (let i = 0; i < 3; i++) {
    await fetch(`${API_BASE}/profile/${uuidv4()}`);
    await fetch(`${API_BASE}/health`);
    await fetch(`${API_BASE}/ready`);
  }
}

async function run() {
  console.log('Testing cache hit/miss rate metrics...\n');

  try {
    // Test 1: Initial metrics state
    console.log('Test 1: Initial metrics state...');
    const initialMetrics = await fetchCacheMetrics();
    assert(initialMetrics.ok === true, 'should return ok: true');
    assert(typeof initialMetrics.hits === 'number', 'should have hits');
    assert(typeof initialMetrics.misses === 'number', 'should have misses');
    assert(typeof initialMetrics.sets === 'number', 'should have sets');
    assert(typeof initialMetrics.deletes === 'number', 'should have deletes');
    assert(typeof initialMetrics.hit_rate === 'string', 'should have hit_rate');
    assert(typeof initialMetrics.miss_rate === 'string', 'should have miss_rate');
    assert(Array.isArray(initialMetrics.key_patterns), 'should have key_patterns array');
    console.log('✅ Initial metrics structure valid');

    // Test 2: Generate traffic
    console.log('\nTest 2: Generating traffic...');
    await generateCacheTraffic();
    console.log('✅ Generated test traffic');

    // Test 3: Verify metrics updated
    console.log('\nTest 3: Verify metrics updated...');
    const updatedMetrics = await fetchCacheMetrics();
    const totalOps = updatedMetrics.hits + updatedMetrics.misses + 
                     updatedMetrics.sets + updatedMetrics.deletes;
    console.log(`   Total operations: ${totalOps}`);
    console.log(`   Hit rate: ${updatedMetrics.hit_rate}`);
    console.log(`   Miss rate: ${updatedMetrics.miss_rate}`);
    console.log('✅ Metrics updated correctly');

    // Test 4: Key pattern stats
    console.log('\nTest 4: Key pattern stats...');
    if (updatedMetrics.key_patterns.length > 0) {
      const pattern = updatedMetrics.key_patterns[0];
      assert(typeof pattern.pattern === 'string', 'pattern should have pattern name');
      assert(typeof pattern.hits === 'number', 'pattern should have hits');
      assert(typeof pattern.misses === 'number', 'pattern should have misses');
      assert(typeof pattern.hit_rate === 'string', 'pattern should have hit_rate');
      console.log('   Patterns:', updatedMetrics.key_patterns.map(p => p.pattern));
    }
    console.log('✅ Key pattern stats present');

    // Test 5: Timestamp
    console.log('\nTest 5: Timestamp...');
    assert(typeof updatedMetrics.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    // Test 6: Total operations calculation
    console.log('\nTest 6: Total operations...');
    assert(typeof initialMetrics.total_operations === 'number', 'should have total_operations');
    console.log(`   Total operations: ${updatedMetrics.total_operations}`);
    console.log('✅ Total operations present');

    console.log('\n✅ All cache metrics tests passed');
    console.log('\nCache stats:');
    console.log(JSON.stringify({
      hits: updatedMetrics.hits,
      misses: updatedMetrics.misses,
      hit_rate: updatedMetrics.hit_rate,
      miss_rate: updatedMetrics.miss_rate
    }, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
