#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const OrchestratorEngine = require('./core/orchestrator-engine');

async function run() {
  const engine = await new OrchestratorEngine().init();

  const cases = [
    {
      name: 'skill domain',
      input: '我想提升技能同報讀課程，做 portfolio',
      expect: 'SKILL'
    },
    {
      name: 'relationship domain',
      input: '我同同事關係緊張，溝通成日出問題',
      expect: 'RELATIONSHIP'
    },
    {
      name: 'decision domain',
      input: '我而家好兩難，唔知應該點做決定',
      expect: 'DECISION'
    }
  ];

  for (const c of cases) {
    const out = await engine.process({ userId: uuidv4(), input: c.input });
    if (!out.output.includes(c.expect)) {
      throw new Error(`${c.name} failed, output missing ${c.expect}`);
    }
  }

  await engine.close();
  console.log('✅ day4 domain coverage test passed');
}

run().catch((err) => {
  console.error('❌ day4 domain coverage test failed:', err.message);
  process.exit(1);
});
