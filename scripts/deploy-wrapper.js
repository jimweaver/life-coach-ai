#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      env: process.env
    });

    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function spawnApi(apiScript) {
  const child = spawn(process.execPath, [apiScript], {
    stdio: 'inherit',
    env: process.env
  });

  const exited = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });

  return { child, exited };
}

async function waitForReady({
  baseUrl,
  timeoutMs,
  intervalMs,
  apiChild
}) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (apiChild.exitCode !== null) {
      return false;
    }

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Math.min(2000, intervalMs));
      const res = await fetch(`${baseUrl}/ready`, { signal: controller.signal });
      clearTimeout(t);

      if (res.status === 200) {
        const body = await res.json();
        if (body.ok === true) return true;
      }
    } catch (_e) {
      // retry
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return false;
}

async function stopApi(child, {
  stopTimeoutMs = 10_000
} = {}) {
  if (!child || child.exitCode !== null) return;

  const done = new Promise((resolve) => {
    child.once('close', () => resolve());
  });

  try {
    child.kill('SIGTERM');
  } catch (_e) {
    // ignore
  }

  const timeout = new Promise((resolve) => {
    setTimeout(resolve, stopTimeoutMs);
  });

  await Promise.race([done, timeout]);

  if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch (_e) {
      // ignore
    }
  }
}

function parseSmokeMode(args) {
  const kv = args.find((a) => a.startsWith('--smoke='));
  if (kv) return kv.split('=')[1] || 'quick';

  if (args.includes('--smoke')) return 'quick';
  return null;
}

function resolveSmokePlan(modeRaw) {
  const mode = String(modeRaw || '').toLowerCase();

  if (!mode) return [];
  if (mode === 'quick') return ['quick'];
  if (mode === 'deep') return ['deep'];
  if (mode === 'all' || mode === 'both') return ['quick', 'deep'];

  throw new Error(`Unsupported smoke mode: ${modeRaw}. Use quick|deep|both`);
}

function parseCanaryMode(args) {
  const kv = args.find((a) => a.startsWith('--canary='));
  if (kv) return kv.split('=')[1] || 'traffic';

  if (args.includes('--canary')) return 'traffic';
  return null;
}

function resolveCanaryPlan(modeRaw) {
  const mode = String(modeRaw || '').toLowerCase();

  if (!mode) return [];
  if (mode === 'traffic' || mode === 'quick') return ['traffic'];

  throw new Error(`Unsupported canary mode: ${modeRaw}. Use traffic`);
}

async function run() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check-only');
  const skipCheck = args.includes('--skip-check');

  const smokeMode = parseSmokeMode(args);
  const smokePlan = resolveSmokePlan(smokeMode);
  const smokeEnabled = smokePlan.length > 0;

  const canaryMode = parseCanaryMode(args);
  const canaryPlan = resolveCanaryPlan(canaryMode);
  const canaryEnabled = canaryPlan.length > 0;

  const managedChecksEnabled = smokeEnabled || canaryEnabled;

  const profileArg = args.find((a) => a.startsWith('--profile='));
  const profilePath = profileArg ? profileArg.split('=')[1] : null;

  const checkScript = path.join(__dirname, 'deployment-check.js');
  const smokeQuickScript = path.join(__dirname, 'smoke-check.js');
  const smokeDeepScript = path.join(__dirname, 'smoke-check-deep.js');
  const canaryScript = path.join(__dirname, 'canary-check.js');
  const apiScript = path.join(__dirname, '..', 'core', 'api-server.js');

  if (!skipCheck) {
    console.log('🔍 Running deployment preflight check...');
    const checkArgs = profilePath ? [profilePath] : [];
    const checkCode = await runNodeScript(checkScript, checkArgs);

    if (checkCode !== 0) {
      console.error('❌ Preflight failed. API startup aborted.');
      process.exit(checkCode);
    }

    console.log('✅ Preflight passed.');
  }

  if (checkOnly) {
    console.log('🧪 deploy-wrapper finished in check-only mode.');
    process.exit(0);
  }

  console.log('🚀 Starting Life Coach API...');

  const { child: api } = spawnApi(apiScript);

  if (!managedChecksEnabled) {
    const forward = (sig) => {
      if (!api.killed) api.kill(sig);
    };

    process.on('SIGINT', () => forward('SIGINT'));
    process.on('SIGTERM', () => forward('SIGTERM'));

    api.on('close', (code) => {
      process.exit(code ?? 0);
    });

    api.on('error', (err) => {
      console.error('❌ Failed to start API:', err.message);
      process.exit(1);
    });

    return;
  }

  const baseUrl = process.env.SMOKE_CHECK_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;
  const readyTimeoutMs = Number(process.env.DEPLOY_WRAPPER_READY_TIMEOUT_MS || 20_000);
  const readyIntervalMs = Number(process.env.DEPLOY_WRAPPER_READY_INTERVAL_MS || 500);

  try {
    const ready = await waitForReady({
      baseUrl,
      timeoutMs: readyTimeoutMs,
      intervalMs: readyIntervalMs,
      apiChild: api
    });

    if (!ready) {
      console.error('❌ API did not become ready in time for managed checks.');
      await stopApi(api, { stopTimeoutMs: Number(process.env.DEPLOY_WRAPPER_STOP_TIMEOUT_MS || 10_000) });
      process.exit(1);
    }

    if (smokeEnabled) {
      console.log(`🧪 Running smoke plan: ${smokePlan.join(', ')}`);

      for (const step of smokePlan) {
        const script = step === 'deep' ? smokeDeepScript : smokeQuickScript;
        const code = await runNodeScript(script);
        if (code !== 0) {
          console.error(`❌ Smoke step failed: ${step}`);
          await stopApi(api, { stopTimeoutMs: Number(process.env.DEPLOY_WRAPPER_STOP_TIMEOUT_MS || 10_000) });
          process.exit(code);
        }
      }
    }

    if (canaryEnabled) {
      console.log(`🧪 Running canary plan: ${canaryPlan.join(', ')}`);

      for (const step of canaryPlan) {
        const code = await runNodeScript(canaryScript);
        if (code !== 0) {
          console.error(`❌ Canary step failed: ${step}`);
          await stopApi(api, { stopTimeoutMs: Number(process.env.DEPLOY_WRAPPER_STOP_TIMEOUT_MS || 10_000) });
          process.exit(code);
        }
      }
    }

    console.log('✅ deploy-wrapper managed check mode completed successfully.');
    await stopApi(api, { stopTimeoutMs: Number(process.env.DEPLOY_WRAPPER_STOP_TIMEOUT_MS || 10_000) });
    process.exit(0);
  } catch (err) {
    console.error('❌ deploy-wrapper managed mode fatal:', err.message);
    await stopApi(api, { stopTimeoutMs: Number(process.env.DEPLOY_WRAPPER_STOP_TIMEOUT_MS || 10_000) });
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('❌ deploy-wrapper fatal:', err.message);
  process.exit(1);
});
