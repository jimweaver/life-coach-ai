#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const { shutdown } = await createServer();
  const base = 'http://localhost:8787';
  const userId = uuidv4();

  try {
    // health
    const h = await fetch(`${base}/health`).then(r => r.json());
    assert(h.ok === true, 'health not ok');

    // set profile
    const p = await fetch(`${base}/profile/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TJ', timezone: 'America/Los_Angeles' })
    }).then(r => r.json());
    assert(p.ok === true, 'profile update failed');

    // create goal
    const g = await fetch(`${base}/goals/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'career',
        title: '轉職 PM',
        description: '6 個月內完成轉職',
        target_date: '2026-08-31'
      })
    }).then(r => r.json());
    assert(!!g.goal_id, 'goal create failed');

    // chat multi-domain
    const c = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        message: '我想轉職但擔心財務同健康壓力'
      })
    }).then(r => r.json());

    assert(c.mode === 'multi-domain', `expected multi-domain, got ${c.mode}`);
    assert(c.output && c.output.length > 20, 'chat output too short');

    // monitor
    const m = await fetch(`${base}/monitor/${userId}`).then(r => r.json());
    assert(!!m.evaluation, 'monitor evaluation missing');

    // intervention
    const i = await fetch(`${base}/intervention/morning/${userId}`).then(r => r.json());
    assert(!!i.message, 'intervention message missing');

    console.log('✅ e2e api test passed');
  } finally {
    await shutdown();
  }
}

run().catch((err) => {
  console.error('❌ e2e api test failed:', err.message);
  process.exit(1);
});
