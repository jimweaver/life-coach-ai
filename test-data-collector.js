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
      description: 'simple tips'
    },
    {
      title: 'NIH sleep and stress evidence',
      url: 'https://www.nih.gov/health-information/sleep',
      description: 'evidence based stress and sleep recommendations'
    }
  ]);

  assert(ranked[0].score >= ranked[1].score, 'ranking should prioritize higher relevance/authority');
  assert(ranked[0].rank === 1 && ranked[1].rank === 2, 'rank assignment invalid');

  console.log('✅ data collector test passed');
}

run().catch((err) => {
  console.error('❌ data collector test failed:', err.message);
  process.exit(1);
});
