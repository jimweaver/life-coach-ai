#!/usr/bin/env node

const {
  resolveHistoryFile,
  loadHistory,
  computeSuggestedThresholds
} = require('./canary-check');

async function main() {
  const historyFileArg = process.argv[2];
  const historyFile = resolveHistoryFile({ historyFile: historyFileArg });

  const history = await loadHistory(historyFile);
  const profile = computeSuggestedThresholds(history, {
    minSamples: Number(process.env.CANARY_PROFILE_MIN_SAMPLES || 5)
  });

  const report = {
    ok: !!profile.ready,
    history_file: historyFile,
    history_entries: history.length,
    profile
  };

  console.log(JSON.stringify(report, null, 2));

  // Not enough data is informational, not fatal.
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, fatal: err.message }, null, 2));
  process.exit(1);
});
