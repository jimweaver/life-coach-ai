#!/usr/bin/env node

/**
 * Stress test for managed smoke orchestration
 * Simulates concurrent deploy-smoke cycles without full API startup
 */

const { spawn } = require('child_process');
const path = require('path');

const DEPLOY_WRAPPER = path.join(__dirname, 'scripts', 'deploy-wrapper.js');

const CONFIG = {
  concurrentRuns: parseInt(process.env.STRESS_CONCURRENT_RUNS || '3', 10),
  smokeDepth: process.env.STRESS_SMOKE_DEPTH || 'quick', // 'quick' or 'deep'
  timeoutMs: parseInt(process.env.STRESS_TIMEOUT_MS || '120000', 10)
};

function log(msg, data = null) {
  const ts = new Date().toISOString();
  const payload = data ? `${msg} ${JSON.stringify(data)}` : msg;
  console.log(`[${ts}] ${payload}`);
}

function runDeploySmoke(runId) {
  return new Promise((resolve) => {
    const start = Date.now();
    const args = [`--smoke=${CONFIG.smokeDepth}`];
    
    log(`[Run ${runId}] Starting deploy-smoke cycle`, { args });
    
    const child = spawn(process.execPath, [DEPLOY_WRAPPER, ...args], {
      env: { 
        ...process.env, 
        DEPLOY_WRAPPER_LOG_FORMAT: 'json',
        DEPLOY_RUN_ID: `stress-${runId}-${Date.now()}`
      },
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';
    const events = [];

    child.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      
      // Parse JSON log lines
      text.split('\n').forEach(line => {
        try {
          const event = JSON.parse(line);
          events.push(event);
        } catch {}
      });
    });

    child.stderr.on('data', (d) => stderr += d.toString());

    // Timeout handler
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, CONFIG.timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - start;
      
      // Analyze events
      const apiStartEvent = events.find(e => e.event === 'api.start');
      const apiReadyEvent = events.find(e => e.event === 'ready.wait.end' && e.ready === true);
      const smokeStartEvent = events.find(e => e.event === 'smoke.start');
      const smokeEndEvent = events.find(e => e.event === 'smoke.end');
      const apiStopEvent = events.find(e => e.event === 'api.stop');
      const wrapperEndEvent = events.find(e => e.event === 'wrapper.end');
      const errors = events.filter(e => e.level === 'error');

      const result = {
        runId,
        success: code === 0,
        code,
        duration,
        events: {
          apiStart: !!apiStartEvent,
          apiReady: !!apiReadyEvent,
          smokeStart: !!smokeStartEvent,
          smokeEnd: !!smokeEndEvent,
          apiStop: !!apiStopEvent,
          wrapperEnd: !!wrapperEndEvent
        },
        timing: {
          apiStartupMs: apiReadyEvent && apiStartEvent 
            ? new Date(apiReadyEvent.ts) - new Date(apiStartEvent.ts)
            : null,
          smokeDurationMs: smokeEndEvent && smokeStartEvent
            ? new Date(smokeEndEvent.ts) - new Date(smokeStartEvent.ts)
            : null
        },
        errorCount: errors.length,
        errors: errors.slice(0, 5).map(e => ({ event: e.event, msg: e.msg }))
      };

      log(`[Run ${runId}] Completed`, { 
        success: result.success, 
        duration: result.duration,
        errors: result.errorCount 
      });
      
      resolve(result);
    });
  });
}

async function runSequentialStressTest() {
  log(`Starting sequential stress test: ${CONFIG.concurrentRuns} deploy-smoke cycles`);
  log('Configuration:', CONFIG);

  const results = [];
  
  for (let i = 1; i <= CONFIG.concurrentRuns; i++) {
    const result = await runDeploySmoke(i);
    results.push(result);
    
    // Small delay between runs
    if (i < CONFIG.concurrentRuns) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

function generateReport(results) {
  const total = results.length;
  const successful = results.filter(r => r.success).length;
  const failed = total - successful;
  
  const durations = results.map(r => r.duration).filter(Boolean);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);

  const apiStartupTimes = results
    .map(r => r.timing.apiStartupMs)
    .filter(Boolean);
  const avgApiStartup = apiStartupTimes.length 
    ? apiStartupTimes.reduce((a, b) => a + b, 0) / apiStartupTimes.length 
    : null;

  const smokeTimes = results
    .map(r => r.timing.smokeDurationMs)
    .filter(Boolean);
  const avgSmokeTime = smokeTimes.length
    ? smokeTimes.reduce((a, b) => a + b, 0) / smokeTimes.length
    : null;

  const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);

  return {
    config: CONFIG,
    summary: {
      totalRuns: total,
      successful,
      failed,
      successRate: ((successful / total) * 100).toFixed(2) + '%',
      totalErrors,
      avgErrorPerRun: (totalErrors / total).toFixed(2)
    },
    timing: {
      avgDurationMs: Math.round(avgDuration),
      maxDurationMs: maxDuration,
      minDurationMs: minDuration,
      avgApiStartupMs: avgApiStartup ? Math.round(avgApiStartup) : null,
      avgSmokeDurationMs: avgSmokeTime ? Math.round(avgSmokeTime) : null
    },
    runs: results.map(r => ({
      runId: r.runId,
      success: r.success,
      duration: r.duration,
      errorCount: r.errorCount
    }))
  };
}

async function main() {
  log('=== Managed Smoke Orchestration Stress Test ===');
  
  const results = await runSequentialStressTest();
  const report = generateReport(results);

  log('=== Stress Test Report ===');
  console.log(JSON.stringify(report, null, 2));

  // Determine pass/fail criteria
  const passCriteria = {
    minSuccessRate: 80, // 80% of runs must succeed
    maxAvgDuration: 120000, // 2 minutes average
    maxErrorsPerRun: 5
  };

  const successRate = parseFloat(report.summary.successRate);
  const avgErrors = parseFloat(report.summary.avgErrorPerRun);
  
  const passed = 
    successRate >= passCriteria.minSuccessRate &&
    report.timing.avgDurationMs <= passCriteria.maxAvgDuration &&
    avgErrors <= passCriteria.maxErrorsPerRun;

  if (passed) {
    log('✅ Stress test PASSED');
    process.exit(0);
  } else {
    log('❌ Stress test FAILED', { 
      successRate: `${successRate}% (required: ${passCriteria.minSuccessRate}%)`,
      avgDuration: `${report.timing.avgDurationMs}ms (max: ${passCriteria.maxAvgDuration}ms)`,
      avgErrors: `${avgErrors} (max: ${passCriteria.maxErrorsPerRun})`
    });
    process.exit(1);
  }
}

main().catch(err => {
  log('❌ Fatal error:', err.message);
  process.exit(1);
});
