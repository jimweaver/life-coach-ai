require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const OrchestratorEngine = require('./orchestrator-engine');
const DatabaseStorageManager = require('./storage/database-storage');
const KBIMonitor = require('./kbi-monitor');
const InterventionEngine = require('./intervention-engine');
const SchedulerRunner = require('./scheduler-runner');
const DataCollector = require('./data-collector');
const {
  isUuid,
  createRateLimiter,
  createRedisRateLimiter,
  badRequest,
  validateChatPayload,
  validateGoalPayload,
  validateUserProfilePayload,
  validateRiskPayload
} = require('./guardrails');

async function createServer() {
  const app = express();
  const port = process.env.PORT || 8787;

  const engine = await new OrchestratorEngine().init();
  const db = new DatabaseStorageManager();
  const kbiMonitor = new KBIMonitor();
  const interventionEngine = new InterventionEngine();
  const scheduler = new SchedulerRunner(db);
  const cronDeliveryMode = scheduler?.delivery?.mode || 'none';
  const dataCollector = new DataCollector();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 120);
  const rateLimitBackend = String(process.env.RATE_LIMIT_BACKEND || 'redis').toLowerCase();
  const rateLimitPrefix = process.env.RATE_LIMIT_KEY_PREFIX || 'lifecoach:rate-limit';

  const rateLimitPolicy = {
    default: Number(process.env.RATE_LIMIT_MAX_DEFAULT || rateLimitMax),
    chat: Number(process.env.RATE_LIMIT_MAX_CHAT || rateLimitMax),
    jobs: Number(process.env.RATE_LIMIT_MAX_JOBS || rateLimitMax),
    intervention: Number(process.env.RATE_LIMIT_MAX_INTERVENTION || rateLimitMax),
    goals: Number(process.env.RATE_LIMIT_MAX_GOALS || rateLimitMax)
  };

  const normalizeClientPart = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    const base = String(raw || 'unknown').split(',')[0].trim();
    if (!base) return 'unknown';
    return base.replace(/[^a-zA-Z0-9:._-]/g, '_');
  };

  const getRouteBucket = (req) => {
    if (req.path === '/chat') return 'chat';
    if (req.path.startsWith('/jobs/')) return 'jobs';
    if (req.path.startsWith('/intervention/')) return 'intervention';
    if (req.path.startsWith('/goals/')) return 'goals';
    return 'default';
  };

  const makeLimiter = (bucket, maxRequests) => {
    const keyFn = (req) => {
      const client = normalizeClientPart(req.headers['x-forwarded-for'] || req.ip);
      return `${bucket}:${client}`;
    };

    const onLimited = async (event) => {
      try {
        await db.logAgentAction(
          'rate-limit-guard',
          null,
          null,
          'rate_limit_exceeded',
          null,
          'success',
          null,
          {
            bucket,
            ...event
          }
        );
      } catch (_e) {
        // best-effort logging only
      }
    };

    const commonOptions = {
      windowMs: rateLimitWindowMs,
      maxRequests,
      keyFn,
      onLimited
    };

    return rateLimitBackend === 'memory'
      ? createRateLimiter(commonOptions)
      : createRedisRateLimiter({
        ...commonOptions,
        redis: db.redis,
        keyPrefix: `${rateLimitPrefix}:${bucket}`,
        fallbackToMemory: true
      });
  };

  const writeLimiters = {
    default: makeLimiter('default', rateLimitPolicy.default),
    chat: makeLimiter('chat', rateLimitPolicy.chat),
    jobs: makeLimiter('jobs', rateLimitPolicy.jobs),
    intervention: makeLimiter('intervention', rateLimitPolicy.intervention),
    goals: makeLimiter('goals', rateLimitPolicy.goals)
  };

  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const bucket = getRouteBucket(req);
    const limiter = writeLimiters[bucket] || writeLimiters.default;
    return limiter(req, res, next);
  });

  app.param('userId', (req, res, next, userId) => {
    if (!isUuid(userId)) {
      return badRequest(res, ['userId path parameter must be a valid UUID']);
    }
    next();
  });

  app.get('/health', async (_req, res) => {
    const status = await db.testConnections();
    res.json({
      ok: status.redis && status.postgres,
      services: status,
      rate_limit_backend: rateLimitBackend,
      rate_limit_policy: rateLimitPolicy,
      cron_delivery_mode: cronDeliveryMode,
      time: new Date().toISOString()
    });
  });

  app.post('/chat', async (req, res) => {
    try {
      const errors = validateChatPayload(req.body);
      if (errors.length) return badRequest(res, errors);

      const { user_id, session_id, message } = req.body;
      const out = await engine.process({
        userId: user_id,
        sessionId: session_id || uuidv4(),
        input: message
      });

      res.json(out);
    } catch (err) {
      console.error('POST /chat error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/profile/:userId', async (req, res) => {
    try {
      const profile = await db.getUserProfile(req.params.userId);
      res.json({ user_id: req.params.userId, profile: profile || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/profile/:userId', async (req, res) => {
    try {
      const errors = validateUserProfilePayload(req.body);
      if (errors.length) return badRequest(res, errors);

      const updated = await db.updateUserProfile(req.params.userId, req.body || {});
      res.json({ ok: true, profile: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/goals/:userId', async (req, res) => {
    try {
      const goals = await db.getGoals(req.params.userId, req.query.status || null);
      res.json({ user_id: req.params.userId, goals });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/goals/:userId', async (req, res) => {
    try {
      const errors = validateGoalPayload(req.body);
      if (errors.length) return badRequest(res, errors);

      const goalId = await db.createGoal(req.params.userId, req.body || {});
      res.json({ ok: true, goal_id: goalId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/kbi/:userId/:metric', async (req, res) => {
    try {
      const metric = req.params.metric;
      if (!/^[a-z_][a-z0-9_]{1,63}$/i.test(metric)) {
        return badRequest(res, ['metric must be an alphanumeric identifier']);
      }

      const data = await db.getKBIMetrics(
        req.params.userId,
        metric,
        req.query.period || 'daily',
        Number(req.query.limit || 30)
      );
      res.json({ user_id: req.params.userId, metric, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/monitor/:userId', async (req, res) => {
    try {
      const metrics = ['goal_adherence', 'engagement_score', 'mood_trend', 'skill_progress'];
      const snapshot = {};

      for (const m of metrics) {
        const rows = await db.getKBIMetrics(req.params.userId, m, 'daily', 1);
        snapshot[m] = rows[0]?.metric_value ?? null;
      }

      const cleaned = Object.fromEntries(Object.entries(snapshot).filter(([, v]) => v !== null));
      const evaluation = kbiMonitor.evaluateSnapshot(cleaned);

      res.json({ user_id: req.params.userId, snapshot: cleaned, evaluation });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/intervention/morning/:userId', async (req, res) => {
    try {
      const profile = await db.getUserProfile(req.params.userId);
      const message = interventionEngine.buildMorningCheckIn({ profile: profile || {} });
      res.json({ user_id: req.params.userId, message });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/intervention/weekly/:userId', async (req, res) => {
    try {
      const metrics = ['goal_adherence', 'engagement_score', 'mood_trend'];
      const summary = {};
      for (const m of metrics) {
        const rows = await db.getKBIMetrics(req.params.userId, m, 'daily', 1);
        summary[m] = rows[0]?.metric_value ?? 'n/a';
      }
      const message = interventionEngine.buildWeeklyReview(summary);
      res.json({ user_id: req.params.userId, message });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/intervention/risk', async (req, res) => {
    try {
      const errors = validateRiskPayload(req.body);
      if (errors.length) return badRequest(res, errors);

      const alerts = req.body?.alerts || [];
      const message = interventionEngine.buildRiskIntervention(alerts);
      res.json({ message, hasIntervention: !!message });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== Data Quality Telemetry ==========

  const VALID_DOMAINS = ['career', 'health', 'finance', 'skill', 'relationship', 'decision'];

  app.get('/data-quality/probe', async (req, res) => {
    try {
      const domain = String(req.query.domain || '').toLowerCase();
      const input = String(req.query.input || '').trim();

      const errors = [];
      if (!domain || !VALID_DOMAINS.includes(domain)) {
        errors.push(`domain must be one of: ${VALID_DOMAINS.join(', ')}`);
      }
      if (!input || input.length < 2) {
        errors.push('input query string is required (min 2 chars)');
      }
      if (input.length > 500) {
        errors.push('input must be <= 500 characters');
      }
      if (errors.length) return badRequest(res, errors);

      const snapshot = await dataCollector.getDomainSnapshot(domain, input);

      res.json({
        ok: true,
        domain,
        input,
        snapshot
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/data-quality/domains', (_req, res) => {
    res.json({
      ok: true,
      domains: VALID_DOMAINS,
      config: {
        max_source_age_days: dataCollector.maxSourceAgeDays,
        dedupe_enabled: dataCollector.enableDedupe,
        brave_configured: !!dataCollector.braveApiKey
      }
    });
  });

  app.get('/jobs/delivery/metrics', async (req, res) => {
    try {
      const windowMinutes = Number(req.query.windowMinutes || 60);
      const limit = Number(req.query.limit || 500);

      if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 10080) {
        return badRequest(res, ['windowMinutes must be an integer between 1 and 10080']);
      }

      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
        return badRequest(res, ['limit must be an integer between 1 and 5000']);
      }

      const [logMetrics, outboxStats] = await Promise.all([
        db.getSchedulerDeliveryMetrics({ windowMinutes, limit }),
        db.getOutboundEventStats(windowMinutes)
      ]);

      const queueKey = scheduler?.delivery?.redisListKey || process.env.CRON_EVENT_REDIS_LIST_KEY || 'lifecoach:cron-events';
      let queueDepth = null;

      if (scheduler?.delivery?.mode === 'redis' && db.redis) {
        queueDepth = await db.redis.llen(queueKey);
      }

      res.json({
        ok: true,
        delivery_mode: scheduler?.delivery?.mode || 'none',
        queue: {
          key: queueKey,
          depth: queueDepth
        },
        log_metrics: logMetrics,
        outbox: outboxStats
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/jobs/run-monitor-cycle', async (req, res) => {
    try {
      const limitUsers = Number(req.body?.limitUsers || 100);
      if (!Number.isInteger(limitUsers) || limitUsers < 1 || limitUsers > 1000) {
        return badRequest(res, ['limitUsers must be an integer between 1 and 1000']);
      }
      const result = await scheduler.runMonitorCycle({ limitUsers });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/jobs/run-retry-cycle', async (req, res) => {
    try {
      const limit = Number(req.body?.limit || 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return badRequest(res, ['limit must be an integer between 1 and 500']);
      }
      const result = await scheduler.runRetryCycle({ limit });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/dead-letter', async (req, res) => {
    try {
      const limit = Number(req.query.limit || 50);
      const eventType = req.query.eventType || null;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return badRequest(res, ['limit must be an integer between 1 and 500']);
      }
      const events = await db.getDeadLetterEvents({ limit, eventType });
      res.json({ ok: true, count: events.length, events });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/jobs/dead-letter/:eventId/replay', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!isUuid(eventId)) {
        return badRequest(res, ['eventId path parameter must be a valid UUID']);
      }

      const maxRetriesRaw = req.body?.maxRetries;
      let maxRetries;
      if (maxRetriesRaw !== undefined) {
        maxRetries = Number(maxRetriesRaw);
        if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 20) {
          return badRequest(res, ['maxRetries must be an integer between 0 and 20']);
        }
      }

      const replay = await scheduler.replayDeadLetterEvent({ eventId, maxRetries });

      if (replay.reason === 'not_found') {
        return res.status(404).json(replay);
      }

      if (replay.reason === 'not_dead_letter' || replay.reason === 'outbox_replay_not_supported') {
        return res.status(400).json(replay);
      }

      res.json(replay);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/jobs/run-morning-cycle', async (req, res) => {
    try {
      const limitUsers = Number(req.body?.limitUsers || 100);
      if (!Number.isInteger(limitUsers) || limitUsers < 1 || limitUsers > 1000) {
        return badRequest(res, ['limitUsers must be an integer between 1 and 1000']);
      }
      const result = await scheduler.runMorningCycle({ limitUsers });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(port, () => {
    console.log(`🚀 Life Coach API running at http://localhost:${port}`);
  });

  const shutdown = async ({ exit = false } = {}) => {
    await new Promise((resolve) => server.close(resolve));
    await engine.close();
    await db.close();
    if (exit) process.exit(0);
  };

  process.on('SIGINT', () => shutdown({ exit: true }));
  process.on('SIGTERM', () => shutdown({ exit: true }));

  return { app, server, shutdown };
}

if (require.main === module) {
  createServer().catch((err) => {
    console.error('Failed to start API server:', err);
    process.exit(1);
  });
}

module.exports = createServer;
