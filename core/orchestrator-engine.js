require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const AgentLoader = require('./agent-loader');
const DatabaseStorageManager = require('./storage/database-storage');
const DomainAgents = require('./domain-agents');
const ConflictResolver = require('./conflict-resolver');
const ModelRouter = require('./model-router');
const DataCollector = require('./data-collector');
const SkillLearning = require('./skill-learning');

class OrchestratorEngine {
  constructor() {
    this.loader = new AgentLoader();
    this.db = new DatabaseStorageManager();
    this.domainAgents = new DomainAgents();
    this.conflictResolver = new ConflictResolver();
    this.modelRouter = new ModelRouter();
    this.dataCollector = new DataCollector();
    this.agents = null;

    // Performance metrics tracking
    this.metrics = {
      requests: {
        total: 0,
        byMode: {},
        byDomain: {}
      },
      latency: {
        totalMs: 0,
        count: 0,
        histogram: {
          under100: 0,   // <100ms
          under500: 0,   // 100-500ms
          under1000: 0,  // 500-1000ms
          under2000: 0,  // 1-2s
          over2000: 0    // >2s
        }
      },
      errors: {
        total: 0,
        byType: {}
      },
      startedAt: Date.now()
    };
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
      finance: ['財務', '錢', '投資', '預算', 'finance', 'money'],
      skill: ['技能', '學習', '課程', '證書', 'portfolio', 'skill'],
      relationship: ['關係', '溝通', '同事', '伴侶', '家人', 'relationship'],
      decision: ['決定', '選擇', '兩難', '取捨', 'decision']
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
      finance: 'finance-coach',
      skill: 'skill-coach',
      relationship: 'relationship-coach',
      decision: 'decision-coach'
    };

    const outputs = await Promise.all(
      targetDomains.map(async (domain) => {
        const [out, snapshot] = await Promise.all([
          this.domainAgents.run(domain, input, context),
          this.dataCollector.getDomainSnapshot(domain, input)
        ]);

        const agentId = domainToAgentId[domain] || `${domain}-coach`;
        out.model = this.modelRouter.forAgent(agentId);
        out.sources = snapshot;
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
      const cites = o.sources?.citations || [];
      const sourceLine = cites.length
        ? `\n來源參考（可信度 ${Math.round((o.sources?.confidence || 0) * 100)}%）：${cites.slice(0, 2).map((c, i) => `${i + 1}) ${c.title}${c.url ? ` (${c.url})` : ''}`).join('；')}`
        : '';
      return `【${o.domain.toUpperCase()} | model: ${o.model || 'n/a'}】\n${o.summary}\n\n建議：\n${recs}${sourceLine}`;
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
    let result;

    try {
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

          await this.db.setSession(sessionId, {
            user_id: userId,
            current_intent: intent,
            last_message_at: new Date().toISOString()
          });

          const elapsedMs = Date.now() - start;
          this.recordMetrics({ mode: 'emergency', domains: ['emergency'], elapsedMs });

          return {
            session_id: sessionId,
            mode: 'emergency',
            output: emergency.safe_output,
            elapsed_ms: elapsedMs
          };
        }
      }

      // Skill creation detection short-circuit
      const skillResult = SkillLearning.analyze(input);
      if (skillResult && skillResult.detected) {
        const response = SkillLearning.buildResponse(skillResult);
        const output = response?.message || '我檢測到你想創建一個 skill，讓我幫你分析一下...';

        await this.persistConversation({
          userId,
          sessionId,
          userInput: input,
          assistantOutput: output,
          agentId: 'skill-learning'
        });

        await this.db.setSession(sessionId, {
          user_id: userId,
          current_intent: { primary_domain: 'skill_learning', domains: ['skill'], urgency: 1, confidence: 1 },
          last_message_at: new Date().toISOString()
        });

        const elapsedMs = Date.now() - start;
        this.recordMetrics({ mode: 'skill_learning', domains: ['skill'], elapsedMs });

        return {
          session_id: sessionId,
          mode: 'skill_learning',
          output,
          skill_learning: {
            detected: true,
            description: skillResult.description,
            keywords: skillResult.keywords
          },
          elapsed_ms: elapsedMs
        };
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

      const elapsedMs = Date.now() - start;
      const mode = intent.domains.length > 1 ? 'multi-domain' : 'single-domain';
      this.recordMetrics({ mode, domains: intent.domains, elapsedMs });

      return {
        session_id: sessionId,
        mode,
        intent,
        risk_level: safety.risk_level,
        conflicts: domainRun.conflicts,
        output: finalOutput,
        elapsed_ms: elapsedMs
      };
    } catch (error) {
      const elapsedMs = Date.now() - start;
      this.recordMetrics({ mode: 'error', domains: [], elapsedMs, error });
      throw error;
    }
  }

  recordMetrics({ mode, domains, elapsedMs, error = null }) {
    // Track request counts
    this.metrics.requests.total++;
    this.metrics.requests.byMode[mode] = (this.metrics.requests.byMode[mode] || 0) + 1;

    domains.forEach(domain => {
      this.metrics.requests.byDomain[domain] = (this.metrics.requests.byDomain[domain] || 0) + 1;
    });

    // Track latency
    this.metrics.latency.totalMs += elapsedMs;
    this.metrics.latency.count++;

    if (elapsedMs < 100) {
      this.metrics.latency.histogram.under100++;
    } else if (elapsedMs < 500) {
      this.metrics.latency.histogram.under500++;
    } else if (elapsedMs < 1000) {
      this.metrics.latency.histogram.under1000++;
    } else if (elapsedMs < 2000) {
      this.metrics.latency.histogram.under2000++;
    } else {
      this.metrics.latency.histogram.over2000++;
    }

    // Track errors
    if (error) {
      this.metrics.errors.total++;
      const errorType = error.name || 'UnknownError';
      this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;
    }
  }

  getMetrics() {
    const uptime = Date.now() - this.metrics.startedAt;
    const avgLatency = this.metrics.latency.count > 0
      ? Math.round(this.metrics.latency.totalMs / this.metrics.latency.count)
      : 0;

    return {
      uptime_ms: uptime,
      uptime_formatted: this.formatDuration(uptime),
      requests: {
        total: this.metrics.requests.total,
        by_mode: this.metrics.requests.byMode,
        by_domain: this.metrics.requests.byDomain,
        rate_per_minute: this.metrics.requests.total > 0
          ? (this.metrics.requests.total / (uptime / 60000)).toFixed(2)
          : 0
      },
      latency: {
        average_ms: avgLatency,
        histogram: this.metrics.latency.histogram,
        percentiles: this.calculatePercentiles()
      },
      errors: {
        total: this.metrics.errors.total,
        rate: this.metrics.requests.total > 0
          ? ((this.metrics.errors.total / this.metrics.requests.total) * 100).toFixed(2) + '%'
          : '0%',
        by_type: this.metrics.errors.byType
      },
      generated_at: new Date().toISOString()
    };
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  calculatePercentiles() {
    // Approximate percentiles based on histogram
    const h = this.metrics.latency.histogram;
    const total = this.metrics.latency.count;

    if (total === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    let cumulative = 0;
    const findPercentile = (target) => {
      cumulative = 0;
      const buckets = [
        { threshold: 100, count: h.under100 },
        { threshold: 500, count: h.under500 },
        { threshold: 1000, count: h.under1000 },
        { threshold: 2000, count: h.under2000 },
        { threshold: Infinity, count: h.over2000 }
      ];

      for (const bucket of buckets) {
        cumulative += bucket.count;
        if (cumulative / total >= target) {
          return bucket.threshold === Infinity ? 2000 : bucket.threshold;
        }
      }
      return 2000;
    };

    return {
      p50: findPercentile(0.5),
      p95: findPercentile(0.95),
      p99: findPercentile(0.99)
    };
  }

  async close() {
    await this.db.close();
  }
}

module.exports = OrchestratorEngine;
