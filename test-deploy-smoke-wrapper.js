#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  const script = path.join(__dirname, 'scripts', 'deploy-wrapper.js');

  const env = {
    ...process.env,
    RATE_LIMIT_BACKEND: 'memory',
    RATE_LIMIT_MAX: '1000',
    RATE_LIMIT_MAX_JOBS: '1000',
    DEPLOY_WRAPPER_READY_TIMEOUT_MS: '30000',
    SMOKE_CHECK_TIMEOUT_MS: '5000',
    SMOKE_CHECK_RETRIES: '3'
  };

  const result = spawnSync(process.execPath, [script, '--smoke=quick'], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  assert(result.status === 0, `expected deploy-wrapper smoke exit 0, got ${result.status}`);

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert(/Running smoke plan: quick/i.test(output), 'expected smoke plan output');
  assert(/smoke check passed/i.test(output), 'expected smoke-check pass message');
  assert(/smoke mode completed successfully/i.test(output), 'expected smoke completion message');

  console.log('✅ deploy smoke wrapper test passed');
}

try {
  run();
} catch (err) {
  console.error('❌ deploy smoke wrapper test failed:', err.message);
  process.exit(1);
}
