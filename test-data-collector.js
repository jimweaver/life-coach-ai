#!/usr/bin/env node

const DataCollector = require('./core/data-collector');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // Force fallback mode for deterministic test
  const collector = new DataCollector({ braveApiKey: null });

  const snapshot = await collector.getDomainSnapshot('career', '我想轉職產品經理');

  assert(snapshot.provider === 'fallback', 'expected fallback provider');
  assert(snapshot.mode === 'fallback', 'expected fallback mode');
  assert(Array.isArray(snapshot.results), 'results should be array');
  assert(snapshot.results.length >= 2, 'expected at least 2 fallback citations');
  assert(typeof snapshot.confidence === 'number', 'snapshot confidence should be number');

  const sorted = [...snapshot.results].sort((a, b) => b.score - a.score);
  assert(snapshot.results[0].score >= snapshot.results[1].score, 'results should be score-sorted');
  assert(snapshot.results[0].rank === 1, 'first ranked result should be rank 1');

  const first = snapshot.results[0];
  assert(typeof first.confidence === 'number', 'citation confidence should be number');
  assert('source_host' in first, 'citation should expose source_host');

  // Test ranking with explicit mixed-quality sources
  const ranked = collector.rankResults('health', 'sleep stress management evidence', [
    {
      title: 'General blog post',
      url: 'https://randomblog.example/sleep',
      description: 'simple tips',
      published_at: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      title: 'NIH sleep and stress evidence',
      url: 'https://www.nih.gov/health-information/sleep',
      description: 'evidence based stress and sleep recommendations',
      published_at: new Date().toISOString()
    }
  ]);

  assert(ranked[0].score >= ranked[1].score, 'ranking should prioritize higher relevance/authority');
  assert(ranked[0].rank === 1 && ranked[1].rank === 2, 'rank assignment invalid');
  assert(typeof ranked[0].freshness === 'number', 'freshness score missing');

  // Test freshness filtering + dedupe preprocessing
  const oldDate = new Date(Date.now() - 1400 * 24 * 60 * 60 * 1000).toISOString(); // very old
  const raw = [
    {
      title: 'Same title',
      url: 'https://example.com/a?x=1',
      description: 'duplicate source',
      publishedAt: new Date().toISOString()
    },
    {
      title: 'Same title',
      url: 'https://example.com/a?x=2',
      description: 'duplicate source',
      publishedAt: new Date().toISOString()
    },
    {
      title: 'Too old source',
      url: 'https://old.example.com/legacy',
      description: 'outdated data',
      publishedAt: oldDate
    }
  ];

  const strictCollector = new DataCollector({
    braveApiKey: null,
    maxSourceAgeDays: 365,
    enableDedupe: true
  });

  const processed = strictCollector.preprocessExternalResults(raw);
  assert(processed.length === 1, `expected 1 result after stale+dedupe filter, got ${processed.length}`);

  const extSnapshot = strictCollector.buildSnapshot({
    provider: 'brave',
    mode: 'external',
    domain: 'career',
    query: 'career test',
    rankedResults: strictCollector.rankResults('career', 'career test', processed),
    quality: {
      original_results: raw.length,
      post_filter_results: processed.length,
      stale_removed: 1,
      dedupe_removed: 1,
      freshness_enabled: true,
      max_source_age_days: 365
    }
  });

  assert(extSnapshot.quality.stale_removed === 1, 'stale_removed quality metric incorrect');
  assert(extSnapshot.quality.dedupe_removed === 1, 'dedupe_removed quality metric incorrect');
  assert(extSnapshot.quality.freshness_enabled === true, 'freshness flag missing');

  console.log('✅ data collector test passed');
}

run().catch((err) => {
  console.error('❌ data collector test failed:', err.message);
  process.exit(1);
});
