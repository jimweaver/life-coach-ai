require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const OrchestratorEngine = require('./orchestrator-engine');
const DatabaseStorageManager = require('./storage/database-storage');

async function createServer() {
  const app = express();
  const port = process.env.PORT || 8787;

  const engine = await new OrchestratorEngine().init();
  const db = new DatabaseStorageManager();

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

  const server = app.listen(port, () => {
    console.log(`🚀 Life Coach API running at http://localhost:${port}`);
  });

  const shutdown = async () => {
    server.close();
    await engine.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server };
}

if (require.main === module) {
  createServer().catch((err) => {
    console.error('Failed to start API server:', err);
    process.exit(1);
  });
}

module.exports = createServer;
