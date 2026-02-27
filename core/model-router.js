class ModelRouter {
  constructor() {
    this.models = {
      orchestrator: 'openai-codex/gpt-5.3-codex',
      coding: 'anthropic/claude-opus-4-6',
      general: 'kimi-coding/k2p5'
    };
  }

  /**
   * 根據任務類型選擇模型
   */
  select({ role, requiresCoding = false }) {
    if (role === 'orchestrator') return this.models.orchestrator;
    if (requiresCoding) return this.models.coding;
    return this.models.general;
  }

  forAgent(agentId) {
    const codingAgents = new Set(['safety-guardian', 'conflict-resolver']);

    if (agentId === 'main-orchestrator') {
      return this.select({ role: 'orchestrator' });
    }

    return this.select({ role: 'agent', requiresCoding: codingAgents.has(agentId) });
  }
}

module.exports = ModelRouter;
