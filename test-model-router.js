const ModelRouter = require('./core/model-router');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(function run() {
  const r = new ModelRouter();

  assert(r.forAgent('main-orchestrator') === 'openai-codex/gpt-5.3-codex', 'orchestrator model mismatch');
  assert(r.forAgent('safety-guardian') === 'anthropic/claude-opus-4-6', 'safety model mismatch');
  assert(r.forAgent('career-coach') === 'kimi-coding/k2p5', 'career model mismatch');

  console.log('✅ model-router test passed');
})();
