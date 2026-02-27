const AgentLoader = require('./agent-loader');
const ModelAdapter = require('./model-adapter');

class DomainAgents {
  constructor(options = {}) {
    this.loader = options.loader || new AgentLoader();
    this.modelAdapter = options.modelAdapter || new ModelAdapter();
    this.agentConfigCache = new Map();
  }

  async getAgentConfig(domain) {
    const domainToFolder = {
      career: 'career-coach',
      health: 'health-coach',
      finance: 'finance-coach',
      skill: 'skill-coach',
      relationship: 'relationship-coach',
      decision: 'decision-coach'
    };

    const folder = domainToFolder[domain];
    if (!folder) return null;

    if (this.agentConfigCache.has(folder)) {
      return this.agentConfigCache.get(folder);
    }

    try {
      const cfg = await this.loader.loadAgentConfig(folder);
      this.agentConfigCache.set(folder, cfg);
      return cfg;
    } catch (_e) {
      return null;
    }
  }

  async maybeEnhanceWithModel(domain, input, context, heuristicOutput) {
    const config = await this.getAgentConfig(domain);

    const generated = await this.modelAdapter.generateDomainOutput({
      domain,
      input,
      context,
      agentConfig: config || {},
      agentId: heuristicOutput.agent_id
    });

    if (!generated) {
      return {
        ...heuristicOutput,
        metadata: {
          ...(heuristicOutput.metadata || {}),
          generation_mode: 'heuristic',
          fallback_used: true,
          adapter_mode: this.modelAdapter.mode
        }
      };
    }

    return {
      ...heuristicOutput,
      ...generated,
      metadata: {
        ...(heuristicOutput.metadata || {}),
        ...(generated.metadata || {}),
        fallback_used: false
      }
    };
  }

  buildCareerHeuristic(_input, context) {
    return {
      agent_id: 'career-coach',
      domain: 'career',
      summary: '你呢個問題核心係職涯方向與轉型策略。',
      recommendations: [
        '先定義目標職位（JD）同關鍵能力要求。',
        '做技能差距盤點，拆成 30/60/90 日學習計劃。',
        '建立一份可展示成果（portfolio）提升轉職成功率。'
      ],
      constraints: ['時間投入每週最少 6-8 小時', '需持續 8-12 週'],
      confidence: 0.8,
      metadata: { context_messages: context.recent_messages?.length || 0 }
    };
  }

  buildHealthHeuristic(_input, context) {
    return {
      agent_id: 'health-coach',
      domain: 'health',
      summary: '健康面向重點係壓力管理同睡眠恢復。',
      recommendations: [
        '先固定睡眠時段，連續 14 天建立節律。',
        '每日 20 分鐘低強度運動 + 5 分鐘呼吸練習。',
        '用 1-10 分量化壓力，連續追蹤趨勢。'
      ],
      constraints: ['避免過度訓練', '壓力>8/10時優先減負'],
      confidence: 0.76,
      metadata: { profile_exists: !!context.profile }
    };
  }

  buildFinanceHeuristic(_input, context) {
    return {
      agent_id: 'finance-coach',
      domain: 'finance',
      summary: '財務面向要先保現金流，再安排轉型投資。',
      recommendations: [
        '建立 3-6 個月緊急預備金再做職涯轉換。',
        '用 50/30/20 或零基預算法做月度控支。',
        '把學習成本當投資，但設定上限與回本目標。'
      ],
      constraints: ['先現金流後風險', '不提供具體投資標的建議'],
      confidence: 0.74,
      metadata: { active_goals: context.active_goals?.length || 0 }
    };
  }

  buildSkillHeuristic(_input, context) {
    return {
      agent_id: 'skill-coach',
      domain: 'skill',
      summary: '技能面向重點係「目標能力 → 學習路徑 → 可驗證成果」。',
      recommendations: [
        '先定義目標能力清單（最多 3 項）避免分心。',
        '用 30/60/90 日學習節點做里程碑管理。',
        '每兩週輸出一個可展示成果（demo/筆記/作品）。'
      ],
      constraints: ['每週固定時段學習', '避免同時開太多課程'],
      confidence: 0.75,
      metadata: { active_goals: context.active_goals?.length || 0 }
    };
  }

  buildRelationshipHeuristic(_input, context) {
    return {
      agent_id: 'relationship-coach',
      domain: 'relationship',
      summary: '人際面向重點係先釐清目標，再用低衝突溝通框架。',
      recommendations: [
        '用「事實-感受-需要-請求」格式準備對話。',
        '先對齊共同目標，再討論分歧，降低對抗。',
        '高張力情境先降溫（暫停 20 分鐘）再重啟對話。'
      ],
      constraints: ['避免情緒高峰時做重大結論'],
      confidence: 0.73,
      metadata: { context_messages: context.recent_messages?.length || 0 }
    };
  }

  buildDecisionHeuristic(_input, context) {
    return {
      agent_id: 'decision-coach',
      domain: 'decision',
      summary: '決策面向建議用矩陣法，先比較風險再看可逆性。',
      recommendations: [
        '列出選項 A/B/C 及成功條件。',
        '用「影響/風險/可逆性/時間窗口」打分。',
        '先試行可逆方案，保留調整空間。'
      ],
      constraints: ['高不可逆決策需加一輪冷靜期'],
      confidence: 0.77,
      metadata: { profile_exists: !!context.profile }
    };
  }

  async run(domain, input, context) {
    const heuristics = {
      career: () => this.buildCareerHeuristic(input, context),
      health: () => this.buildHealthHeuristic(input, context),
      finance: () => this.buildFinanceHeuristic(input, context),
      skill: () => this.buildSkillHeuristic(input, context),
      relationship: () => this.buildRelationshipHeuristic(input, context),
      decision: () => this.buildDecisionHeuristic(input, context)
    };

    if (!heuristics[domain]) {
      return {
        agent_id: 'general',
        domain,
        summary: `暫未有 ${domain} 專用處理，先提供通用建議。`,
        recommendations: ['先澄清目標', '拆解為可執行步驟', '設定跟進節點'],
        constraints: [],
        confidence: 0.55,
        metadata: { generation_mode: 'heuristic' }
      };
    }

    const heuristicOutput = heuristics[domain]();
    return this.maybeEnhanceWithModel(domain, input, context, heuristicOutput);
  }
}

module.exports = DomainAgents;
