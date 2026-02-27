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
    CANARY_REQUEST_COUNT: '1',
    CANARY_REQUEST_TIMEOUT_MS: '10000',
    CANARY_MAX_ERROR_RATE: '0.9',
    CANARY_P95_MAX_MS: '10000',
    CANARY_AVG_MAX_MS: '10000'
  };

  const result = spawnSync(process.execPath, [script, '--canary=traffic'], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  assert(result.status === 0, `expected deploy-wrapper canary exit 0, got ${result.status}`);

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert(/Running canary plan: traffic/i.test(output), 'expected canary plan output');
  assert(/managed check mode completed successfully/i.test(output), 'expected managed mode completion message');

  console.log('✅ deploy canary wrapper test passed');
}

try {
  run();
} catch (err) {
  console.error('❌ deploy canary wrapper test failed:', err.message);
  process.exit(1);
}
