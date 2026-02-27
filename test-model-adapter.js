#!/usr/bin/env node

const ModelAdapter = require('./core/model-adapter');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // 1) Auto mode without API key should skip model call
  const noKeyAdapter = new ModelAdapter({
    mode: 'auto',
    apiKey: null,
    fetchImpl: async () => {
      throw new Error('fetch should not be called in auto mode without key');
    }
  });

  const skipped = await noKeyAdapter.generateDomainOutput({
    domain: 'career',
    input: '我想轉職',
    context: {},
    agentConfig: { model: 'kimi-coding/k2p5' },
    agentId: 'career-coach'
  });

  assert(skipped === null, 'expected null when no API key in auto mode');

  // 2) Force mode with mocked model API should return normalized domain output
  let requestCount = 0;
  const mockFetch = async (_url, _opts) => {
    requestCount += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: '你目前最重要係先確認轉職目標同風險承受度。',
                recommendations: [
                  '本週完成目標職位 JD 差距表。',
                  '兩週內完成 1 個作品集案例。',
                  '每週安排 2 次模擬面試練習。'
                ],
                constraints: ['每週至少投入 6 小時'],
                confidence: 0.84,
                reasoning_brief: '基於目標導向 + 可行性優先。'
              })
            }
          }
        ]
      })
    };
  };

  const adapter = new ModelAdapter({
    mode: 'force',
    apiKey: 'test-key',
    baseUrl: 'https://mock.api/v1',
    fetchImpl: mockFetch,
    retryBaseDelayMs: 1,
    retryJitterMs: 0
  });

  const out = await adapter.generateDomainOutput({
    domain: 'career',
    input: '我想轉職產品經理',
    context: {
      profile: { name: 'TJ' },
      recent_messages: [{ role: 'user', content: '最近有啲焦慮' }],
      active_goals: [{ domain: 'career', title: '轉職 PM', progress: 0.3 }]
    },
    agentConfig: {
      model: 'kimi-coding/k2p5',
      system_prompt: '你是 Career Coach。'
    },
    agentId: 'career-coach'
  });

  assert(requestCount === 1, 'expected one model API call');
  assert(out.agent_id === 'career-coach', 'agent_id mismatch');
  assert(out.domain === 'career', 'domain mismatch');
  assert(Array.isArray(out.recommendations) && out.recommendations.length >= 3, 'recommendations invalid');
  assert(out.metadata?.generation_mode === 'model-adapter', 'generation_mode should be model-adapter');
  assert(out.metadata?.adapter_attempts === 1, 'adapter_attempts should be 1');

  // 3) Retry/backoff behavior: first call fails with 503, second succeeds
  let retryFetchCount = 0;
  const retryFetch = async () => {
    retryFetchCount += 1;
    if (retryFetchCount === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => 'service unavailable'
      };
    }

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: '先穩定節奏，再逐步推進。',
                recommendations: ['整理優先級清單', '設定 30/60/90 日節點', '每週回顧一次進度'],
                constraints: ['避免一次過改太多'],
                confidence: 0.77
              })
            }
          }
        ]
      })
    };
  };

  const retryAdapter = new ModelAdapter({
    mode: 'force',
    apiKey: 'test-key',
    fetchImpl: retryFetch,
    retryMax: 2,
    retryBaseDelayMs: 1,
    retryJitterMs: 0
  });

  const retryOut = await retryAdapter.generateDomainOutput({
    domain: 'health',
    input: '最近睡眠好差',
    context: {},
    agentConfig: { model: 'kimi-coding/k2p5' },
    agentId: 'health-coach'
  });

  assert(retryFetchCount === 2, `expected retry count 2, got ${retryFetchCount}`);
  assert(retryOut.metadata?.adapter_attempts === 2, 'expected success on second attempt');

  // 4) Strict schema validation should throw in force mode
  const badSchemaAdapter = new ModelAdapter({
    mode: 'force',
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: '太短',
                recommendations: ['only one'],
                confidence: 2
              })
            }
          }
        ]
      })
    }),
    retryMax: 0,
    retryBaseDelayMs: 1,
    retryJitterMs: 0
  });

  let schemaFailed = false;
  try {
    await badSchemaAdapter.generateDomainOutput({
      domain: 'finance',
      input: '想改善預算',
      context: {},
      agentConfig: { model: 'kimi-coding/k2p5' },
      agentId: 'finance-coach'
    });
  } catch (err) {
    schemaFailed = String(err.message).includes('schema validation failed');
  }

  assert(schemaFailed, 'expected schema validation failure in force mode');

  console.log('✅ model adapter test passed');
}

run().catch((err) => {
  console.error('❌ model adapter test failed:', err.message);
  process.exit(1);
});
