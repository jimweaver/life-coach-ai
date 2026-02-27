/**
 * test-data-quality-api.js
 * Tests for the /data-quality/* API endpoints.
 */

const assert = require('assert');
const DataCollector = require('./core/data-collector');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passed++;
        console.log(`  ✅ ${name}`);
      }).catch((err) => {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
      });
    }
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

async function run() {
  console.log('\n📊 Data Quality API Tests\n');

  // ── DataCollector: snapshot quality block structure ──

  await test('getDomainSnapshot returns quality block in fallback mode', async () => {
    const dc = new DataCollector({ braveApiKey: null });
    const snapshot = await dc.getDomainSnapshot('career', 'I want to switch to software engineering');

    assert.ok(snapshot, 'snapshot should exist');
    assert.strictEqual(snapshot.mode, 'fallback');
    assert.strictEqual(snapshot.domain, 'career');
    assert.ok(snapshot.quality, 'quality block must exist');
    assert.strictEqual(typeof snapshot.quality.dedupe_removed, 'number');
    assert.strictEqual(typeof snapshot.quality.stale_removed, 'number');
    assert.ok(Array.isArray(snapshot.citations), 'citations must be an array');
    assert.ok(snapshot.citations.length > 0, 'should have at least 1 citation');
    assert.strictEqual(typeof snapshot.confidence, 'number');
    assert.ok(snapshot.generated_at, 'generated_at must be present');
  });

  await test('getDomainSnapshot returns quality block for every domain', async () => {
    const dc = new DataCollector({ braveApiKey: null });
    const domains = ['career', 'health', 'finance', 'skill', 'relationship', 'decision'];

    for (const domain of domains) {
      const snapshot = await dc.getDomainSnapshot(domain, 'test input');
      assert.ok(snapshot, `snapshot for ${domain}`);
      assert.strictEqual(snapshot.domain, domain);
      assert.ok(snapshot.quality, `quality block for ${domain}`);
      assert.ok(snapshot.citations, `citations for ${domain}`);
      assert.strictEqual(snapshot.mode, 'fallback');
    }
  });

  await test('quality block includes freshness_enabled flag in fallback', async () => {
    const dc = new DataCollector({ braveApiKey: null });
    const snapshot = await dc.getDomainSnapshot('health', 'how to manage stress');

    assert.strictEqual(snapshot.quality.freshness_enabled, false);
  });

  // ── Citation structure ──

  await test('citations include expected fields', async () => {
    const dc = new DataCollector({ braveApiKey: null });
    const snapshot = await dc.getDomainSnapshot('finance', 'budget planning');

    for (const cit of snapshot.citations) {
      assert.ok('rank' in cit, 'citation must have rank');
      assert.ok('title' in cit, 'citation must have title');
      assert.ok('confidence' in cit, 'citation must have confidence');
      assert.strictEqual(typeof cit.confidence, 'number');
      assert.ok(cit.confidence >= 0 && cit.confidence <= 1, `confidence in range: ${cit.confidence}`);
    }
  });

  // ── Snapshot metadata ──

  await test('snapshot metadata includes provider, total_results, confidence', async () => {
    const dc = new DataCollector({ braveApiKey: null });
    const snapshot = await dc.getDomainSnapshot('decision', 'should I take the job offer');

    assert.strictEqual(snapshot.provider, 'fallback');
    assert.strictEqual(typeof snapshot.total_results, 'number');
    assert.ok(snapshot.total_results > 0);
    assert.strictEqual(typeof snapshot.confidence, 'number');
    assert.ok(snapshot.confidence > 0 && snapshot.confidence <= 1);
    assert.ok(snapshot.query, 'query must be present');
  });

  // ── External mode quality block (simulated) ──

  await test('buildSnapshot produces quality block with external filter metrics', () => {
    const dc = new DataCollector({ braveApiKey: null });

    const results = [
      { title: 'Result 1', url: 'https://example.com/1', description: 'Desc 1', published_at: null, _publishedDate: null },
      { title: 'Result 2', url: 'https://example.com/2', description: 'Desc 2', published_at: null, _publishedDate: null }
    ];

    const ranked = dc.rankResults('career', 'software career', results);
    const snapshot = dc.buildSnapshot({
      provider: 'brave',
      mode: 'external',
      domain: 'career',
      query: 'software career',
      rankedResults: ranked,
      quality: {
        original_results: 8,
        post_filter_results: 2,
        stale_removed: 4,
        dedupe_removed: 2,
        freshness_enabled: true,
        max_source_age_days: 1200
      }
    });

    assert.strictEqual(snapshot.quality.original_results, 8);
    assert.strictEqual(snapshot.quality.post_filter_results, 2);
    assert.strictEqual(snapshot.quality.stale_removed, 4);
    assert.strictEqual(snapshot.quality.dedupe_removed, 2);
    assert.strictEqual(snapshot.quality.freshness_enabled, true);
    assert.strictEqual(snapshot.mode, 'external');
    assert.strictEqual(snapshot.provider, 'brave');
  });

  // ── Scoring sanity ──

  await test('scoreResult returns all expected scoring fields', () => {
    const dc = new DataCollector();
    const result = {
      title: 'Career transition guide',
      url: 'https://hbr.org/career-guide',
      description: 'How to navigate a career change successfully with job market data',
      _publishedDate: new Date(Date.now() - 7 * 86_400_000) // 7 days ago
    };

    const scores = dc.scoreResult('career', 'career change transition', result);

    assert.strictEqual(typeof scores.relevance, 'number');
    assert.strictEqual(typeof scores.authority, 'number');
    assert.strictEqual(typeof scores.domain_fit, 'number');
    assert.strictEqual(typeof scores.freshness, 'number');
    assert.strictEqual(typeof scores.score, 'number');
    assert.strictEqual(typeof scores.confidence, 'number');
    assert.ok(scores.score >= 0.05 && scores.score <= 0.99);
    assert.ok(scores.confidence >= 0.25 && scores.confidence <= 1);
  });

  // ── Config endpoint validation ──

  await test('DataCollector exposes config fields for /data-quality/domains', () => {
    const dc = new DataCollector({ braveApiKey: null, maxSourceAgeDays: 365, enableDedupe: true });

    assert.strictEqual(dc.maxSourceAgeDays, 365);
    assert.strictEqual(dc.enableDedupe, true);
    assert.strictEqual(dc.braveApiKey, null);

    // Domains available
    const domains = Object.keys(dc.queryByDomain);
    assert.ok(domains.includes('career'));
    assert.ok(domains.includes('health'));
    assert.ok(domains.includes('finance'));
    assert.ok(domains.includes('skill'));
    assert.ok(domains.includes('relationship'));
    assert.ok(domains.includes('decision'));
  });

  // ── Summary ──

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
