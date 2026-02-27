#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

function createDeployLogger() {
  const format = String(process.env.DEPLOY_WRAPPER_LOG_FORMAT || 'text').toLowerCase();
  const json = format === 'json';

  const emit = (level, event, details = {}) => {
    const payload = {
      component: 'deploy-wrapper',
      level,
      event,
      ts: new Date().toISOString(),
      ...details
    };

    if (json) {
      console.log(JSON.stringify(payload));
      return;
    }

    const icon = level === 'error' ? '❌' : 'ℹ️';
    const detailText = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    console.log(`${icon} [deploy-wrapper] ${event}${detailText}`);
  };

  return {
    json,
    info: (event, details) => emit('info', event, details),
    error: (event, details) => emit('error', event, details)
  };
}

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

  return { child };
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

async function runScriptStep({ logger, step, scriptPath, args = [] }) {
  const started = Date.now();
  logger.info(`${step}.start`, {
    script: path.basename(scriptPath),
    args
  });

  const code = await runNodeScript(scriptPath, args);
  const duration = Date.now() - started;

  logger.info(`${step}.end`, {
    code,
    duration_ms: duration
  });

  return { code, duration_ms: duration };
}

async function run() {
  const startedAt = Date.now();
  const logger = createDeployLogger();

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

  logger.info('wrapper.start', {
    args,
    check_only: checkOnly,
    skip_check: skipCheck,
    smoke_plan: smokePlan,
    canary_plan: canaryPlan,
    managed_checks_enabled: managedChecksEnabled,
    profile: profilePath || null
  });

  const checkScript = path.join(__dirname, 'deployment-check.js');
  const smokeQuickScript = path.join(__dirname, 'smoke-check.js');
  const smokeDeepScript = path.join(__dirname, 'smoke-check-deep.js');
  const canaryScript = path.join(__dirname, 'canary-check.js');
  const apiScript = path.join(__dirname, '..', 'core', 'api-server.js');

  if (!skipCheck) {
    if (!logger.json) {
      console.log('🔍 Running deployment preflight check...');
    }

    const checkArgs = profilePath ? [profilePath] : [];
    const preflight = await runScriptStep({
      logger,
      step: 'preflight',
      scriptPath: checkScript,
      args: checkArgs
    });

    if (preflight.code !== 0) {
      if (!logger.json) {
        console.error('❌ Preflight failed. API startup aborted.');
      }
      logger.error('wrapper.abort', {
        reason: 'preflight_failed',
        exit_code: preflight.code,
        total_ms: Date.now() - startedAt
      });
      process.exit(preflight.code);
    }

    if (!logger.json) {
      console.log('✅ Preflight passed.');
    }
  }

  if (checkOnly) {
    if (!logger.json) {
      console.log('🧪 deploy-wrapper finished in check-only mode.');
    }
    logger.info('check_only.complete', {
      total_ms: Date.now() - startedAt
    });
    process.exit(0);
  }

  if (!logger.json) {
    console.log('🚀 Starting Life Coach API...');
  }
  logger.info('api.start');

  const { child: api } = spawnApi(apiScript);

  if (!managedChecksEnabled) {
    const forward = (sig) => {
      logger.info('signal.forward', { signal: sig });
      if (!api.killed) api.kill(sig);
    };

    process.on('SIGINT', () => forward('SIGINT'));
    process.on('SIGTERM', () => forward('SIGTERM'));

    api.on('close', (code, signal) => {
      logger.info('api.exit', {
        code: code ?? 0,
        signal: signal || null,
        total_ms: Date.now() - startedAt
      });
      process.exit(code ?? 0);
    });

    api.on('error', (err) => {
      logger.error('api.error', {
        error: err.message,
        total_ms: Date.now() - startedAt
      });
      if (!logger.json) {
        console.error('❌ Failed to start API:', err.message);
      }
      process.exit(1);
    });

    return;
  }

  const baseUrl = process.env.SMOKE_CHECK_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;
  const readyTimeoutMs = Number(process.env.DEPLOY_WRAPPER_READY_TIMEOUT_MS || 20_000);
  const readyIntervalMs = Number(process.env.DEPLOY_WRAPPER_READY_INTERVAL_MS || 500);
  const stopTimeoutMs = Number(process.env.DEPLOY_WRAPPER_STOP_TIMEOUT_MS || 10_000);

  try {
    const readyStarted = Date.now();
    logger.info('ready.wait.start', {
      base_url: baseUrl,
      timeout_ms: readyTimeoutMs,
      interval_ms: readyIntervalMs
    });

    const ready = await waitForReady({
      baseUrl,
      timeoutMs: readyTimeoutMs,
      intervalMs: readyIntervalMs,
      apiChild: api
    });

    logger.info('ready.wait.end', {
      ready,
      duration_ms: Date.now() - readyStarted
    });

    if (!ready) {
      if (!logger.json) {
        console.error('❌ API did not become ready in time for managed checks.');
      }
      logger.error('wrapper.abort', {
        reason: 'api_not_ready',
        total_ms: Date.now() - startedAt
      });

      const stopStarted = Date.now();
      logger.info('api.stop.start', { reason: 'api_not_ready' });
      await stopApi(api, { stopTimeoutMs });
      logger.info('api.stop.end', { duration_ms: Date.now() - stopStarted });

      process.exit(1);
    }

    if (smokeEnabled) {
      if (!logger.json) {
        console.log(`🧪 Running smoke plan: ${smokePlan.join(', ')}`);
      }
      const smokeStarted = Date.now();
      logger.info('smoke.plan.start', { steps: smokePlan });

      for (const step of smokePlan) {
        const script = step === 'deep' ? smokeDeepScript : smokeQuickScript;
        const smokeStep = await runScriptStep({
          logger,
          step: `smoke.${step}`,
          scriptPath: script
        });

        if (smokeStep.code !== 0) {
          if (!logger.json) {
            console.error(`❌ Smoke step failed: ${step}`);
          }

          logger.error('wrapper.abort', {
            reason: 'smoke_failed',
            smoke_step: step,
            exit_code: smokeStep.code,
            total_ms: Date.now() - startedAt
          });

          const stopStarted = Date.now();
          logger.info('api.stop.start', { reason: 'smoke_failed' });
          await stopApi(api, { stopTimeoutMs });
          logger.info('api.stop.end', { duration_ms: Date.now() - stopStarted });

          process.exit(smokeStep.code);
        }
      }

      logger.info('smoke.plan.end', {
        duration_ms: Date.now() - smokeStarted,
        steps: smokePlan
      });
    }

    if (canaryEnabled) {
      if (!logger.json) {
        console.log(`🧪 Running canary plan: ${canaryPlan.join(', ')}`);
      }
      const canaryStarted = Date.now();
      logger.info('canary.plan.start', { steps: canaryPlan });

      for (const step of canaryPlan) {
        const canaryStep = await runScriptStep({
          logger,
          step: `canary.${step}`,
          scriptPath: canaryScript
        });

        if (canaryStep.code !== 0) {
          if (!logger.json) {
            console.error(`❌ Canary step failed: ${step}`);
          }

          logger.error('wrapper.abort', {
            reason: 'canary_failed',
            canary_step: step,
            exit_code: canaryStep.code,
            total_ms: Date.now() - startedAt
          });

          const stopStarted = Date.now();
          logger.info('api.stop.start', { reason: 'canary_failed' });
          await stopApi(api, { stopTimeoutMs });
          logger.info('api.stop.end', { duration_ms: Date.now() - stopStarted });

          process.exit(canaryStep.code);
        }
      }

      logger.info('canary.plan.end', {
        duration_ms: Date.now() - canaryStarted,
        steps: canaryPlan
      });
    }

    if (!logger.json) {
      console.log('✅ deploy-wrapper managed check mode completed successfully.');
    }

    const stopStarted = Date.now();
    logger.info('api.stop.start', { reason: 'managed_checks_complete' });
    await stopApi(api, { stopTimeoutMs });
    logger.info('api.stop.end', { duration_ms: Date.now() - stopStarted });

    logger.info('wrapper.complete', {
      ok: true,
      total_ms: Date.now() - startedAt,
      smoke_plan: smokePlan,
      canary_plan: canaryPlan
    });

    process.exit(0);
  } catch (err) {
    if (!logger.json) {
      console.error('❌ deploy-wrapper managed mode fatal:', err.message);
    }

    logger.error('wrapper.fatal', {
      error: err.message,
      total_ms: Date.now() - startedAt
    });

    const stopStarted = Date.now();
    logger.info('api.stop.start', { reason: 'managed_mode_fatal' });
    await stopApi(api, { stopTimeoutMs });
    logger.info('api.stop.end', { duration_ms: Date.now() - stopStarted });

    process.exit(1);
  }
}

run().catch((err) => {
  console.error('❌ deploy-wrapper fatal:', err.message);
  process.exit(1);
});
