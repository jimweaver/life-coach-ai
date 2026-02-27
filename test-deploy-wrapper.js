#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  const script = path.join(__dirname, 'scripts', 'deploy-wrapper.js');

  const result = spawnSync(process.execPath, [script, '--check-only'], {
    cwd: __dirname,
    env: process.env,
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  assert(result.status === 0, `expected deploy-wrapper --check-only exit 0, got ${result.status}`);

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert(/Preflight passed/i.test(output), 'expected preflight pass message');
  assert(/check-only mode/i.test(output), 'expected check-only completion message');

  console.log('✅ deploy wrapper test passed');
}

try {
  run();
} catch (err) {
  console.error('❌ deploy wrapper test failed:', err.message);
  process.exit(1);
}
