class InterventionEngine {
  buildMorningCheckIn(userContext = {}) {
    const name = userContext?.profile?.name || '你';
    return `早晨 ${name} 👋
今日你最想推進嘅一件事係咩？
如果你願意，我可以幫你拆成 3 個可執行步驟。`;
  }

  buildWeeklyReview(kbiSummary = {}) {
    const lines = [
      '🗓️ 本週回顧',
      `- Goal adherence: ${kbiSummary.goal_adherence ?? 'n/a'}`,
      `- Engagement: ${kbiSummary.engagement_score ?? 'n/a'}`,
      `- Mood trend: ${kbiSummary.mood_trend ?? 'n/a'}`,
      '',
      '下週建議：聚焦一個最有槓桿嘅目標，減少同時進行項目。'
    ];
    return lines.join('\n');
  }

  buildRiskIntervention(alerts = []) {
    const top = alerts.find(a => a.level === 'critical') || alerts.find(a => a.level === 'warn');
    if (!top) return null;

    if (top.metric === 'mood_trend') {
      return '我留意到你最近情緒分數偏低。要唔要我幫你做個 5 分鐘減壓流程？';
    }

    if (top.metric === 'goal_adherence') {
      return '你目標進度有少少落後。建議你先縮細範圍，只做下一個最小步驟。';
    }

    return `我留意到 ${top.metric} 有風險（${top.level}）。我可以幫你即刻調整計劃。`;
  }
}

module.exports = InterventionEngine;
