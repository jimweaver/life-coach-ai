#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const DatabaseStorageManager = require('../core/storage/database-storage');

function nowIso() {
  return new Date().toISOString();
}

function addCheck(checks, name, ok, details = null, level = 'info') {
  checks.push({ name, ok, level, details, at: nowIso() });
}

async function run() {
  const profilePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'config', 'deployment', 'openclaw-local.profile.json');

  const checks = [];
  const warnings = [];
  const errors = [];

  if (!fs.existsSync(profilePath)) {
    addCheck(checks, 'deployment_profile_file', false, `profile not found: ${profilePath}`, 'error');
    errors.push(`profile not found: ${profilePath}`);

    const report = {
      ok: false,
      profile_path: profilePath,
      checks,
      warnings,
      errors
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    addCheck(checks, 'deployment_profile_file', true, profilePath);
  } catch (err) {
    addCheck(checks, 'deployment_profile_parse', false, err.message, 'error');
    errors.push(`profile parse failed: ${err.message}`);

    const report = {
      ok: false,
      profile_path: profilePath,
      checks,
      warnings,
      errors
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // Required env
  const requiredEnv = profile?.env?.required || [];
  for (const key of requiredEnv) {
    const value = process.env[key];
    const ok = typeof value === 'string' && value.trim().length > 0;

    addCheck(checks, `env_required:${key}`, ok, ok ? 'present' : 'missing', ok ? 'info' : 'error');
    if (!ok) errors.push(`missing required env: ${key}`);
  }

  // Recommended env
  const recommendedEnv = profile?.env?.recommended || [];
  for (const key of recommendedEnv) {
    const value = process.env[key];
    const ok = typeof value === 'string' && value.trim().length > 0;
    addCheck(checks, `env_recommended:${key}`, ok, ok ? 'present' : 'not set', ok ? 'info' : 'warn');
    if (!ok) warnings.push(`recommended env not set: ${key}`);
  }

  // Basic files
  const initSqlPath = path.join(__dirname, '..', 'storage', 'postgres', 'init.sql');
  const hasInitSql = fs.existsSync(initSqlPath);
  addCheck(checks, 'postgres_init_sql', hasInitSql, initSqlPath, hasInitSql ? 'info' : 'error');
  if (!hasInitSql) errors.push(`missing schema file: ${initSqlPath}`);

  let db = null;
  try {
    db = new DatabaseStorageManager();
    const status = await db.testConnections();

    addCheck(checks, 'redis_connectivity', !!status.redis, status.redis ? 'connected' : status.error, status.redis ? 'info' : 'error');
    addCheck(checks, 'postgres_connectivity', !!status.postgres, status.postgres ? 'connected' : status.error, status.postgres ? 'info' : 'error');

    if (!status.redis) errors.push('redis connectivity failed');
    if (!status.postgres) errors.push('postgres connectivity failed');
  } catch (err) {
    addCheck(checks, 'database_connectivity', false, err.message, 'error');
    errors.push(`database connectivity exception: ${err.message}`);
  } finally {
    if (db) {
      await db.close().catch(() => {});
    }
  }

  const report = {
    ok: errors.length === 0,
    profile: {
      id: profile.profile_id,
      name: profile.name,
      version: profile.version
    },
    profile_path: profilePath,
    checks,
    warnings,
    errors,
    generated_at: nowIso()
  };

  console.log(JSON.stringify(report, null, 2));
  if (errors.length > 0) process.exit(1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, fatal: err.message }, null, 2));
  process.exit(1);
});
