require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const AgentLoader = require('./agent-loader');
const DatabaseStorageManager = require('./storage/database-storage');
const DomainAgents = require('./domain-agents');
const ConflictResolver = require('./conflict-resolver');
const ModelRouter = require('./model-router');

class OrchestratorEngine {
  constructor() {
    this.loader = new AgentLoader();
    this.db = new DatabaseStorageManager();
    this.domainAgents = new DomainAgents();
    this.conflictResolver = new ConflictResolver();
    this.modelRouter = new ModelRouter();
    this.agents = null;
  }

  async init() {
    this.agents = await this.loader.loadCoreAgents();
    return this;
  }

  classifyIntent(text = '') {
    const lower = text.toLowerCase();

    const domainMap = {
      career: ['工作', '職涯', '轉職', '升遷', '面試', '履歷', 'career', 'job'],
      health: ['健康', '壓力', '焦慮', '睡眠', 'health', 'stress'],
      finance: ['財務', '錢', '投資', '預算', 'finance', 'money']
    };

    const matchedDomains = [];
    for (const [domain, kws] of Object.entries(domainMap)) {
      const score = kws.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
      if (score > 0) matchedDomains.push({ domain, score });
    }

    matchedDomains.sort((a, b) => b.score - a.score);

    const urgencyKeywords = ['緊急', '救命', '唔想活', '自殺', 'crisis', 'urgent'];
    const urgency = urgencyKeywords.some(k => lower.includes(k)) ? 5 : 2;

    return {
      primary_domain: matchedDomains[0]?.domain || 'career',
      domains: matchedDomains.map(d => d.domain),
      urgency,
      confidence: matchedDomains.length ? 0.8 : 0.5
    };
  }

  async retrieveContext(userId, sessionId) {
    let [profile, recentMessages, goals] = await Promise.all([
      this.db.getUserProfile(userId),
      this.db.getRecentMessages(userId, 10),
      this.db.getGoals(userId, 'active')
    ]);

    // Ensure FK-safe user row exists in DB
    if (!profile) {
      profile = await this.db.createUserProfile(userId, {
        user_id: userId,
        created_at: new Date().toISOString(),
        preferences: {
          communication_style: 'direct',
          advice_type: 'suggestive'
        },
        goals: []
      });
    }

    return {
      profile: profile || {},
      recent_messages: recentMessages || [],
      active_goals: goals || [],
      session: await this.db.getSession(sessionId)
    };
  }

  async runDomains(domains, input, context) {
    const targetDomains = domains.length ? domains : ['career'];

    const domainToAgentId = {
      career: 'career-coach',
      health: 'health-coach',
      finance: 'finance-coach'
    };

    const outputs = await Promise.all(
      targetDomains.map(async (domain) => {
        const out = await this.domainAgents.run(domain, input, context);
        const agentId = domainToAgentId[domain] || `${domain}-coach`;
        out.model = this.modelRouter.forAgent(agentId);
        return out;
      })
    );

    const conflicts = this.conflictResolver.detect(outputs);
    const resolved = this.conflictResolver.resolve(outputs, conflicts);

    return {
      outputs: resolved.resolved,
      conflict_notes: resolved.notes,
      conflicts
    };
  }

  safetyCheck(text) {
    const critical = ['自殺', '唔想活', '自殘', '殺死', '結束生命'];
    const high = ['絕望', '崩潰', '活唔落去', '冇希望'];

    const criticalHit = critical.find(k => text.includes(k));
    const highHit = high.find(k => text.includes(k));

    if (criticalHit) {
      return {
        passed: false,
        risk_level: 'CRITICAL',
        action: 'EMERGENCY_RESPONSE',
        safe_output: '我聽到你而家非常辛苦。你嘅安全最重要。如果你有即時危險，請即刻打 999 或去最近急症室。你唔需要一個人面對。'
      };
    }

    if (highHit) {
      return {
        passed: true,
        risk_level: 'HIGH',
        action: 'WARN',
        warning: 'Detected high-risk emotional signal'
      };
    }

    return {
      passed: true,
      risk_level: 'NONE',
      action: 'PASS'
    };
  }

  composeUserResponse(domainRun) {
    const blocks = domainRun.outputs.map((o) => {
      const recs = o.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n');
      return `【${o.domain.toUpperCase()} | model: ${o.model || 'n/a'}】\n${o.summary}\n\n建議：\n${recs}`;
    });

    const conflictBlock = domainRun.conflict_notes?.length
      ? `\n\n【跨領域協調】\n${domainRun.conflict_notes.map(n => `- ${n}`).join('\n')}`
      : '';

    return `${blocks.join('\n\n')}\n${conflictBlock}`.trim();
  }

  async persistConversation({ userId, sessionId, userInput, assistantOutput, agentId }) {
    await this.db.createConversation(sessionId, userId, { source: 'orchestrator-engine' });

    await this.db.addMessage(sessionId, userId, 'user', userInput, null, 0.6);
    await this.db.addMessage(sessionId, userId, 'assistant', assistantOutput, agentId, 0.8);

    // lightweight KBI tracking
    await this.db.recordKBIMetric(userId, 'engagement_score', 1);
  }

  async process({ userId, input, sessionId = uuidv4() }) {
    const start = Date.now();

    const intent = this.classifyIntent(input);
    const context = await this.retrieveContext(userId, sessionId);

    // Emergency short-circuit
    if (intent.urgency >= 5) {
      const emergency = this.safetyCheck(input);
      if (!emergency.passed) {
        await this.persistConversation({
          userId,
          sessionId,
          userInput: input,
          assistantOutput: emergency.safe_output,
          agentId: 'safety-guardian'
        });

        return {
          session_id: sessionId,
          mode: 'emergency',
          output: emergency.safe_output,
          elapsed_ms: Date.now() - start
        };
      }
    }

    const domainRun = await this.runDomains(intent.domains, input, context);
    const merged = this.composeUserResponse(domainRun);

    const safety = this.safetyCheck(merged);
    const finalOutput = safety.passed ? merged : safety.safe_output;

    await this.persistConversation({
      userId,
      sessionId,
      userInput: input,
      assistantOutput: finalOutput,
      agentId: safety.passed ? (intent.domains.join(',') || 'career') : 'safety-guardian'
    });

    await this.db.setSession(sessionId, {
      user_id: userId,
      current_intent: intent,
      last_message_at: new Date().toISOString()
    });

    return {
      session_id: sessionId,
      mode: intent.domains.length > 1 ? 'multi-domain' : 'single-domain',
      intent,
      risk_level: safety.risk_level,
      conflicts: domainRun.conflicts,
      output: finalOutput,
      elapsed_ms: Date.now() - start
    };
  }

  async close() {
    await this.db.close();
  }
}

module.exports = OrchestratorEngine;
