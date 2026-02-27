#!/usr/bin/env node

require('dotenv').config();
const createServer = require('./core/api-server');

async function run() {
  process.env.RATE_LIMIT_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_MAX = '4';
  process.env.RATE_LIMIT_BACKEND = 'redis';
  process.env.RATE_LIMIT_KEY_PREFIX = `lifecoach:test:guardrails:${Date.now()}:${process.pid}`;

  const { shutdown } = await createServer();
  const base = 'http://localhost:8787';

  try {
    // 1) chat payload validation
    const badChat = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'bad-id', message: '' })
    });

    if (badChat.status !== 400) {
      throw new Error(`expected /chat 400, got ${badChat.status}`);
    }

    const badChatBody = await badChat.json();
    if (badChatBody.error !== 'validation_error') {
      throw new Error('expected validation_error payload for /chat');
    }

    // 2) userId param validation
    const badProfile = await fetch(`${base}/profile/not-a-uuid`);
    if (badProfile.status !== 400) {
      throw new Error(`expected /profile/:userId 400, got ${badProfile.status}`);
    }

    // 3) rate limit for POST routes
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`${base}/intervention/risk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alerts: [] })
      });

      if (r.status !== 200) {
        throw new Error(`expected pre-limit risk request 200, got ${r.status}`);
      }
    }

    const limited = await fetch(`${base}/intervention/risk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alerts: [] })
    });

    if (limited.status !== 429) {
      throw new Error(`expected rate limit 429, got ${limited.status}`);
    }

    console.log('✅ api guardrails test passed');
  } finally {
    await shutdown();
  }
}

run().catch((err) => {
  console.error('❌ api guardrails test failed:', err.message);
  process.exit(1);
});
