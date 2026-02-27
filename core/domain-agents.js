class DomainAgents {
  async handleCareer(input, context) {
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

  async handleHealth(input, context) {
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

  async handleFinance(input, context) {
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

  async run(domain, input, context) {
    if (domain === 'career') return this.handleCareer(input, context);
    if (domain === 'health') return this.handleHealth(input, context);
    if (domain === 'finance') return this.handleFinance(input, context);

    return {
      agent_id: 'general',
      domain,
      summary: `暫未有 ${domain} 專用處理，先提供通用建議。`,
      recommendations: ['先澄清目標', '拆解為可執行步驟', '設定跟進節點'],
      constraints: [],
      confidence: 0.55,
      metadata: {}
    };
  }
}

module.exports = DomainAgents;
