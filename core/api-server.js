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

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 120);
  const rateLimitBackend = String(process.env.RATE_LIMIT_BACKEND || 'redis').toLowerCase();

  const writeLimiter = rateLimitBackend === 'memory'
    ? createRateLimiter({
      windowMs: rateLimitWindowMs,
      maxRequests: rateLimitMax
    })
    : createRedisRateLimiter({
      redis: db.redis,
      windowMs: rateLimitWindowMs,
      maxRequests: rateLimitMax,
      keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX || 'lifecoach:rate-limit',
      fallbackToMemory: true
    });

  app.use((req, res, next) => {
    if (req.method === 'POST') return writeLimiter(req, res, next);
    next();
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
