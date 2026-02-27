#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseJsonLines(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.component === 'deploy-wrapper' && parsed.event) {
        out.push(parsed);
      }
    } catch (_e) {
      // ignore non-json lines
    }
  }
  return out;
}

function run() {
  const script = path.join(__dirname, 'scripts', 'deploy-wrapper.js');

  const env = {
    ...process.env,
    DEPLOY_WRAPPER_LOG_FORMAT: 'json'
  };

  const result = spawnSync(process.execPath, [script, '--check-only', '--skip-check'], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  assert(result.status === 0, `expected deploy-wrapper observability run exit 0, got ${result.status}`);

  const events = parseJsonLines(result.stdout);
  assert(events.length >= 2, `expected >=2 deploy-wrapper events, got ${events.length}`);

  const hasStart = events.some((e) => e.event === 'wrapper.start');
  const done = events.find((e) => e.event === 'check_only.complete');

  assert(hasStart, 'missing wrapper.start event');
  assert(!!done, 'missing check_only.complete event');
  assert(typeof done.total_ms === 'number', 'check_only.complete missing total_ms number');

  console.log('✅ deploy observability test passed');
}

try {
  run();
} catch (err) {
  console.error('❌ deploy observability test failed:', err.message);
  process.exit(1);
}
