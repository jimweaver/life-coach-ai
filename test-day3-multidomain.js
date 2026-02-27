#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const OrchestratorEngine = require('./core/orchestrator-engine');

async function run() {
  console.log('🧪 Day 3 Multi-domain Test\n');

  const engine = await new OrchestratorEngine().init();

  const userId = uuidv4();
  const input = '我想轉職，但擔心財務壓力同睡眠變差，應該點安排？';

  const result = await engine.process({ userId, input });

  console.log('Result:');
  console.log(`- mode: ${result.mode}`);
  console.log(`- domains: ${result.intent.domains.join(', ')}`);
  console.log(`- risk: ${result.risk_level}`);
  console.log(`- elapsed: ${result.elapsed_ms}ms`);

  if (result.mode !== 'multi-domain') {
    throw new Error('Expected multi-domain mode');
  }

  if (result.intent.domains.length < 2) {
    throw new Error('Expected >=2 domains');
  }

  if (!result.output.includes('CAREER') || !result.output.includes('HEALTH') || !result.output.includes('FINANCE')) {
    throw new Error('Expected merged domain sections in output');
  }

  if (result.elapsed_ms > 8000) {
    throw new Error(`Too slow: ${result.elapsed_ms}ms`);
  }

  await engine.close();

  console.log('\n✅ Day 3 multi-domain test passed');
}

run().catch(async (err) => {
  console.error('\n❌ Day 3 multi-domain test failed:', err.message);
  process.exit(1);
});
