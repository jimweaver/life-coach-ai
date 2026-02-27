#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const AgentLoader = require('./core/agent-loader');
const OrchestratorEngine = require('./core/orchestrator-engine');

async function run() {
  console.log('🧪 Day 2 Core Agents Smoke Test\n');

  // 1) Config load + validate
  const loader = new AgentLoader();
  const agents = await loader.loadCoreAgents();

  console.log('1️⃣ Loaded core agents:');
  Object.values(agents).forEach(a => {
    console.log(`   - ${a.agent_id} (${a.model})`);
  });

  const validations = await Promise.all(
    Object.values(agents).map(async (cfg) => ({
      agent_id: cfg.agent_id,
      ...(await loader.validateAgentConfig(cfg))
    }))
  );

  const invalid = validations.filter(v => !v.valid);
  if (invalid.length) {
    console.error('\n❌ Invalid configs:', invalid);
    process.exit(1);
  }
  console.log('✅ All core configs valid\n');

  // 2) Engine init
  const engine = await new OrchestratorEngine().init();

  // 3) Test sample request
  const userId = uuidv4();
  const res = await engine.process({
    userId,
    input: '我想 6 個月內轉去做產品經理，應該點規劃？'
  });

  console.log('2️⃣ Engine output:');
  console.log(`   mode: ${res.mode}`);
  console.log(`   elapsed: ${res.elapsed_ms}ms`);
  console.log(`   primary domain: ${res.intent.primary_domain}`);
  console.log('\n--- User Output ---\n');
  console.log(res.output);
  console.log('\n-------------------\n');

  // 4) Basic assertions
  if (!res.output || res.output.length < 20) {
    throw new Error('Output too short / empty');
  }

  if (res.elapsed_ms > 8000) {
    throw new Error(`Response too slow: ${res.elapsed_ms}ms`);
  }

  console.log('✅ Day 2 smoke test passed');

  await engine.close();
}

run().catch(err => {
  console.error('\n❌ Day 2 smoke test failed:', err.message);
  process.exit(1);
});
