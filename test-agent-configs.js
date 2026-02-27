#!/usr/bin/env node

const AgentLoader = require('./core/agent-loader');

async function run() {
  const loader = new AgentLoader();
  const all = await loader.loadAllAgents();
  const ids = Object.keys(all).sort();

  console.log(`Loaded ${ids.length} agent configs`);
  ids.forEach(id => console.log(`- ${id} (${all[id].model})`));

  if (ids.length !== 14) {
    throw new Error(`Expected 14 agents, got ${ids.length}`);
  }

  const checks = await Promise.all(ids.map(async (id) => ({ id, ...(await loader.validateAgentConfig(all[id])) })));
  const bad = checks.filter(c => !c.valid);
  if (bad.length) {
    console.error('Invalid configs:', bad);
    process.exit(1);
  }

  console.log('✅ All 14 agent configs valid');
}

run().catch(err => {
  console.error('❌ test-agent-configs failed:', err.message);
  process.exit(1);
});
