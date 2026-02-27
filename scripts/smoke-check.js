#!/usr/bin/env node

const baseUrl = process.env.SMOKE_CHECK_BASE_URL || 'http://localhost:8787';
const timeoutMs = Number(process.env.SMOKE_CHECK_TIMEOUT_MS || 5000);
const maxRetries = Number(process.env.SMOKE_CHECK_RETRIES || 3);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHealth() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: controller.signal
    });
    clearTimeout(t);
    return res;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

async function run() {
  let lastErr = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetchHealth();

      if (res.status !== 200) {
        throw new Error(`health returned ${res.status}`);
      }

      const body = await res.json();

      if (body.ok !== true) {
        throw new Error(`health ok=false`);
      }

      if (!body.services?.redis || !body.services?.postgres) {
        throw new Error(`services unhealthy: redis=${body.services?.redis}, postgres=${body.services?.postgres}`);
      }

      console.log('✅ smoke check passed');
      console.log(`   services: redis=${body.services.redis}, postgres=${body.services.postgres}`);
      console.log(`   delivery_mode: ${body.cron_delivery_mode || 'none'}`);
      process.exit(0);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        console.log(`⚠️  attempt ${attempt} failed: ${err.message}. retrying...`);
        await sleep(1000);
      }
    }
  }

  console.error('❌ smoke check failed:', lastErr?.message || 'unknown');
  process.exit(1);
}

run();
