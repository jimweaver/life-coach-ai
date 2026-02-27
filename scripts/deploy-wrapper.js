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

async function run() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check-only');
  const skipCheck = args.includes('--skip-check');

  const profileArg = args.find((a) => a.startsWith('--profile='));
  const profilePath = profileArg ? profileArg.split('=')[1] : null;

  const checkScript = path.join(__dirname, 'deployment-check.js');
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

  const api = spawn(process.execPath, [apiScript], {
    stdio: 'inherit',
    env: process.env
  });

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
}

run().catch((err) => {
  console.error('❌ deploy-wrapper fatal:', err.message);
  process.exit(1);
});
