class ModelAdapter {
  constructor(options = {}) {
    this.mode = String(options.mode ?? process.env.DOMAIN_MODEL_ADAPTER_MODE ?? 'auto').toLowerCase();
    this.provider = options.provider ?? process.env.DOMAIN_MODEL_PROVIDER ?? 'openai-compatible';
    this.apiKey = options.apiKey ?? process.env.DOMAIN_MODEL_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
    this.baseUrl = String(options.baseUrl ?? process.env.DOMAIN_MODEL_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.defaultModel = options.defaultModel ?? process.env.DOMAIN_MODEL_NAME ?? 'gpt-4o-mini';
    this.timeoutMs = Number(options.timeoutMs ?? process.env.DOMAIN_MODEL_TIMEOUT_MS ?? 12000);
    this.maxContextMessages = Number(options.maxContextMessages ?? process.env.DOMAIN_MODEL_MAX_CONTEXT_MESSAGES ?? 4);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  shouldAttempt() {
    if (this.mode === 'off') return false;
    if (this.mode === 'force') return true;
    return !!this.apiKey;
  }

  buildSystemPrompt(domain, agentConfig = {}) {
    const domainHint = {
      career: '職涯規劃、轉職策略與能力建設',
      health: '睡眠、壓力、可持續健康習慣',
      finance: '現金流、預算、風險控制',
      skill: '技能路徑、學習節奏、作品輸出',
      relationship: '溝通、人際修復、低衝突策略',
      decision: '選項評估、風險/回報、可逆性'
    };

    const configured = String(agentConfig.system_prompt || '').trim();
    if (configured) return configured.slice(0, 4500);

    return [
      `你是 Life Coach 系統中的 ${domain} 專家代理。`,
      `你專注：${domainHint[domain] || '通用生活決策支持'}。`,
      '請輸出務實、可執行、具時序的建議。',
      '回覆必須是 JSON 物件，不能輸出 markdown。'
    ].join('\n');
  }

  buildUserPrompt({ domain, input, context }) {
    const contextBrief = {
      profile: context?.profile || {},
      active_goals: (context?.active_goals || []).slice(0, 3).map((g) => ({
        domain: g.domain,
        title: g.title,
        progress: g.progress,
        status: g.status
      })),
      recent_messages: (context?.recent_messages || []).slice(0, this.maxContextMessages).map((m) => ({
        role: m.role,
        content: String(m.content || '').slice(0, 240)
      }))
    };

    return [
      `Domain: ${domain}`,
      `User input: ${input}`,
      `Context JSON: ${JSON.stringify(contextBrief)}`,
      '',
      '請輸出 JSON，格式如下：',
      '{',
      '  "summary": "一句到兩句總結",',
      '  "recommendations": ["建議1", "建議2", "建議3"],',
      '  "constraints": ["限制或風險1"],',
      '  "confidence": 0.0,',
      '  "reasoning_brief": "簡短推理摘要（可選）"',
      '}',
      '',
      '要求：',
      '- recommendations 至少 3 條',
      '- 每條可執行（可量化或有時間節點）',
      '- confidence 介乎 0~1'
    ].join('\n');
  }

  async callOpenAiCompatible({ model, messages }) {
    if (!this.fetchImpl) throw new Error('fetch implementation unavailable');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload = {
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages
      };

      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`model adapter HTTP ${response.status}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  extractMessageContent(raw) {
    return raw?.choices?.[0]?.message?.content || '';
  }

  parseJsonContent(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('empty model content');
    }

    const direct = content.trim();
    try {
      return JSON.parse(direct);
    } catch (_ignore) {
      // continue
    }

    const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }

    const jsonLike = direct.match(/\{[\s\S]*\}/);
    if (jsonLike?.[0]) {
      return JSON.parse(jsonLike[0]);
    }

    throw new Error('no parseable json found');
  }

  normalizeResult({ parsed, domain, agentId, model }) {
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
        .filter((x) => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, 5)
      : [];

    if (!summary || recommendations.length < 3) {
      throw new Error('model output missing required summary/recommendations');
    }

    const constraints = Array.isArray(parsed.constraints)
      ? parsed.constraints.filter((x) => typeof x === 'string').slice(0, 4)
      : [];

    const rawConfidence = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0.72;

    return {
      agent_id: agentId,
      domain,
      summary,
      recommendations,
      constraints,
      confidence,
      metadata: {
        generation_mode: 'model-adapter',
        adapter_provider: this.provider,
        adapter_model: model,
        reasoning_brief: typeof parsed.reasoning_brief === 'string' ? parsed.reasoning_brief : null
      }
    };
  }

  async generateDomainOutput({ domain, input, context, agentConfig = {}, agentId }) {
    if (!this.shouldAttempt()) return null;

    const model = agentConfig.model || this.defaultModel;
    const messages = [
      {
        role: 'system',
        content: this.buildSystemPrompt(domain, agentConfig)
      },
      {
        role: 'user',
        content: this.buildUserPrompt({ domain, input, context })
      }
    ];

    try {
      const raw = await this.callOpenAiCompatible({ model, messages });
      const content = this.extractMessageContent(raw);
      const parsed = this.parseJsonContent(content);
      return this.normalizeResult({ parsed, domain, agentId, model });
    } catch (error) {
      if (this.mode === 'force') throw error;
      return null;
    }
  }
}

module.exports = ModelAdapter;
