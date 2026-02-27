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

async function createServer() {
  const app = express();
  const port = process.env.PORT || 8787;

  const engine = await new OrchestratorEngine().init();
  const db = new DatabaseStorageManager();
  const kbiMonitor = new KBIMonitor();
  const interventionEngine = new InterventionEngine();
  const scheduler = new SchedulerRunner(db);

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.get('/health', async (_req, res) => {
    const status = await db.testConnections();
    res.json({
      ok: status.redis && status.postgres,
      services: status,
      time: new Date().toISOString()
    });
  });

  app.post('/chat', async (req, res) => {
    try {
      const { user_id, session_id, message } = req.body || {};
      if (!user_id || !message) {
        return res.status(400).json({ error: 'user_id and message are required' });
      }

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
      const goalId = await db.createGoal(req.params.userId, req.body || {});
      res.json({ ok: true, goal_id: goalId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/kbi/:userId/:metric', async (req, res) => {
    try {
      const data = await db.getKBIMetrics(
        req.params.userId,
        req.params.metric,
        req.query.period || 'daily',
        Number(req.query.limit || 30)
      );
      res.json({ user_id: req.params.userId, metric: req.params.metric, data });
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
      const result = await scheduler.runMonitorCycle({ limitUsers });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/jobs/run-morning-cycle', async (req, res) => {
    try {
      const limitUsers = Number(req.body?.limitUsers || 100);
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
