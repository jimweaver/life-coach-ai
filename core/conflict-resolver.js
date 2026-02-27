class ConflictResolver {
  detect(outputs = []) {
    const conflicts = [];

    // Simple rule: finance says reduce spending, career says increase spending massively
    const finance = outputs.find(o => o.domain === 'finance');
    const career = outputs.find(o => o.domain === 'career');

    if (finance && career) {
      const financeStrict = finance.recommendations.some(r => r.includes('現金流'));
      const careerInvest = career.recommendations.some(r => r.includes('portfolio') || r.includes('學習'));
      if (financeStrict && careerInvest) {
        conflicts.push({
          type: 'resource_competition',
          severity: 'MEDIUM',
          details: '職涯投入與財務保守策略存在資源競爭'
        });
      }
    }

    return conflicts;
  }

  resolve(outputs = [], conflicts = []) {
    if (!conflicts.length) {
      return {
        resolved: outputs,
        notes: []
      };
    }

    // Add balancing recommendation
    const notes = [
      '採用「分階段投入」策略：先完成緊急預備金，再逐步增加職涯投入。'
    ];

    return {
      resolved: outputs,
      notes
    };
  }
}

module.exports = ConflictResolver;
