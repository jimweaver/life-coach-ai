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
const AlertRouter = require('./alert-router');
const AlertOwnershipDriftDetector = require('./alert-ownership-drift');
const CanaryDriftDetector = require('./canary-drift-detector');
const {
  resolveHistoryFile,
  loadHistory,
  computeSuggestedThresholds
} = require('../scripts/canary-check');
const {
  computeCanaryDriftTrend
} = require('../scripts/canary-drift-trend');
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
  const alertRouter = new AlertRouter({
    db,
    delivery: scheduler?.delivery
  });
  const ownershipDriftDetector = new AlertOwnershipDriftDetector();
  const canaryDriftDetector = new CanaryDriftDetector();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  const gracefulShutdownMs = Number(process.env.SHUTDOWN_GRACE_MS || 10_000);
  const readinessStartedAt = new Date().toISOString();
  let isShuttingDown = false;
  let activeRequests = 0;
  let shutdownPromise = null;

  app.use((req, res, next) => {
    if (isShuttingDown && req.path !== '/health' && req.path !== '/ready') {
      res.set('Retry-After', '5');
      return res.status(503).json({
        error: 'server_shutting_down',
        message: 'Server is shutting down. Please retry shortly.'
      });
    }

    activeRequests += 1;
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      activeRequests = Math.max(0, activeRequests - 1);
    };

    res.on('finish', settle);
    res.on('close', settle);

    next();
  });

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

  const parseStringList = (raw) => String(raw || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const normalizeReplayApproverStrategy = (raw) => {
    const strategy = String(raw || 'either').trim().toLowerCase();
    if (['either', 'allowlist', 'role', 'both'].includes(strategy)) return strategy;
    return 'either';
  };

  const deadLetterReplayPolicy = {
    maxLimit: Number(process.env.DEADLETTER_REPLAY_MAX_LIMIT || 500),
    approvalThreshold: Number(process.env.DEADLETTER_REPLAY_APPROVAL_THRESHOLD || 50),
    requireApproval: String(process.env.DEADLETTER_REPLAY_REQUIRE_APPROVAL || 'true').toLowerCase() !== 'false',
    approvalCode: process.env.DEADLETTER_REPLAY_APPROVAL_CODE || null,
    approverStrategy: normalizeReplayApproverStrategy(process.env.DEADLETTER_REPLAY_APPROVER_STRATEGY),
    approverAllowlist: parseStringList(process.env.DEADLETTER_REPLAY_APPROVER_ALLOWLIST),
    approverRoles: parseStringList(process.env.DEADLETTER_REPLAY_APPROVER_ROLES)
  };

  const extractReplayOperator = (req) => {
    const fromBodyId = req.body?.operatorId ? String(req.body.operatorId).trim() : '';
    const fromHeaderId = req.headers['x-operator-id'] ? String(req.headers['x-operator-id']).trim() : '';
    const operatorId = fromBodyId || fromHeaderId || null;

    const fromBodyRole = req.body?.operatorRole ? String(req.body.operatorRole).trim() : '';
    const fromHeaderRole = req.headers['x-operator-role'] ? String(req.headers['x-operator-role']).trim() : '';
    const operatorRole = (fromBodyRole || fromHeaderRole || '').toLowerCase() || null;

    return {
      operatorId: operatorId ? operatorId.toLowerCase() : null,
      operatorRole
    };
  };

  const evaluateReplayApprover = ({ operatorId, operatorRole }) => {
    const allowlist = deadLetterReplayPolicy.approverAllowlist;
    const roles = deadLetterReplayPolicy.approverRoles;
    const strategy = deadLetterReplayPolicy.approverStrategy;

    const hasAllowlist = allowlist.length > 0;
    const hasRoles = roles.length > 0;

    // No policy configured => do not enforce approver identity gate.
    if (!hasAllowlist && !hasRoles) {
      return {
        policyEnforced: false,
        authorized: true,
        idAllowed: true,
        roleAllowed: true,
        strategy
      };
    }

    const idAllowed = hasAllowlist && !!operatorId && allowlist.includes(operatorId);
    const roleAllowed = hasRoles && !!operatorRole && roles.includes(operatorRole);

    let authorized;
    if (strategy === 'allowlist') {
      authorized = idAllowed;
    } else if (strategy === 'role') {
      authorized = roleAllowed;
    } else if (strategy === 'both') {
      authorized = idAllowed && roleAllowed;
    } else {
      // either
      authorized = idAllowed || roleAllowed;
    }

    return {
      policyEnforced: true,
      authorized,
      idAllowed,
      roleAllowed,
      strategy
    };
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
      readiness: {
        accepting_traffic: !isShuttingDown,
        active_requests: activeRequests,
        shutdown_grace_ms: gracefulShutdownMs,
        started_at: readinessStartedAt
      },
      rate_limit_backend: rateLimitBackend,
      rate_limit_policy: rateLimitPolicy,
      cron_delivery_mode: cronDeliveryMode,
      dead_letter_replay_policy: {
        max_limit: deadLetterReplayPolicy.maxLimit,
        approval_threshold: deadLetterReplayPolicy.approvalThreshold,
        require_approval: deadLetterReplayPolicy.requireApproval,
        approval_code_configured: !!deadLetterReplayPolicy.approvalCode,
        approver_strategy: deadLetterReplayPolicy.approverStrategy,
        approver_allowlist_count: deadLetterReplayPolicy.approverAllowlist.length,
        approver_roles_count: deadLetterReplayPolicy.approverRoles.length,
        approver_policy_enforced: deadLetterReplayPolicy.approverAllowlist.length > 0 || deadLetterReplayPolicy.approverRoles.length > 0
      },
      delivery_alert_policy: {
        route_enabled: String(process.env.DELIVERY_ALERT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
        route_retry_max: Number(process.env.DELIVERY_ALERT_ROUTE_RETRY_MAX || 1),
        route_strategy: String(process.env.DELIVERY_ALERT_ROUTE_STRATEGY || 'single').toLowerCase(),
        route_channel: process.env.DELIVERY_ALERT_ROUTE_CHANNEL || 'cron-event',
        route_user_id_configured: !!process.env.DELIVERY_ALERT_ROUTE_USER_ID,
        route_user_warn_configured: !!process.env.DELIVERY_ALERT_ROUTE_USER_ID_WARN,
        route_user_critical_configured: !!process.env.DELIVERY_ALERT_ROUTE_USER_ID_CRITICAL,
        escalation_enabled: String(process.env.DELIVERY_ALERT_ESCALATION_ENABLED || 'false').toLowerCase() !== 'false',
        escalation_min_level: String(process.env.DELIVERY_ALERT_ESCALATION_MIN_LEVEL || 'critical').toLowerCase(),
        escalation_user_id_configured: !!process.env.DELIVERY_ALERT_ESCALATION_USER_ID,
        escalation_channel: process.env.DELIVERY_ALERT_ESCALATION_CHANNEL || (process.env.DELIVERY_ALERT_ROUTE_CHANNEL || 'cron-event'),
        oncall_sync_enabled: String(process.env.DELIVERY_ALERT_ONCALL_SYNC_ENABLED || 'false').toLowerCase() !== 'false',
        oncall_source_file_configured: !!process.env.DELIVERY_ALERT_ONCALL_FILE,
        oncall_refresh_ms: Number(process.env.DELIVERY_ALERT_ONCALL_REFRESH_MS || 60000),
        owner_drift_warn_stale_minutes: Number(process.env.ALERT_OWNER_DRIFT_WARN_STALE_MINUTES || 120),
        owner_drift_critical_stale_minutes: Number(process.env.ALERT_OWNER_DRIFT_CRITICAL_STALE_MINUTES || 360),
        owner_drift_strict: String(process.env.ALERT_OWNER_DRIFT_STRICT || 'false').toLowerCase() === 'true',
        owner_drift_route_enabled: String(process.env.ALERT_OWNER_DRIFT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
        owner_drift_route_min_level: String(process.env.ALERT_OWNER_DRIFT_ROUTE_MIN_LEVEL || 'critical').toLowerCase()
      },
      canary_drift_policy: {
        route_enabled: String(process.env.CANARY_DRIFT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
        route_min_level: String(process.env.CANARY_DRIFT_ROUTE_MIN_LEVEL || 'warn').toLowerCase(),
        warn_ratio: Number(process.env.CANARY_DRIFT_WARN_RATIO || 0.25),
        critical_ratio: Number(process.env.CANARY_DRIFT_CRITICAL_RATIO || 0.5),
        profile_min_samples: Number(process.env.CANARY_PROFILE_MIN_SAMPLES || 5),
        trend_default_since_minutes: Number(process.env.CANARY_DRIFT_TREND_DEFAULT_SINCE_MINUTES || 1440),
        trend_default_bucket_minutes: Number(process.env.CANARY_DRIFT_TREND_DEFAULT_BUCKET_MINUTES || 60),
        history_file: resolveHistoryFile()
      },
      time: new Date().toISOString()
    });
  });

  app.get('/ready', (_req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({
        ok: false,
        accepting_traffic: false,
        active_requests: activeRequests,
        reason: 'server_shutting_down'
      });
    }

    return res.json({
      ok: true,
      accepting_traffic: true,
      active_requests: activeRequests,
      started_at: readinessStartedAt
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

  app.get('/jobs/delivery/route-policy', async (req, res) => {
    try {
      const forceSync = String(req.query.sync || 'false').toLowerCase() === 'true';

      if (scheduler && typeof scheduler.getAlertRoutePolicy === 'function') {
        const policy = await scheduler.getAlertRoutePolicy({ forceSync });
        return res.json({ ok: true, policy });
      }

      const cfg = scheduler?.deliveryAlertConfig || {};
      return res.json({
        ok: true,
        policy: {
          route_enabled: !!cfg.routeEnabled,
          route_strategy: cfg.routeStrategy || 'single',
          route_retry_max: Number(cfg.routeRetryMax || 0),
          route_channel: cfg.routeChannel || 'cron-event',
          route_user_id: cfg.routeUserId || null,
          route_user_id_warn: cfg.routeUserIdWarn || null,
          route_user_id_critical: cfg.routeUserIdCritical || null,
          escalation_enabled: !!cfg.escalationEnabled,
          escalation_min_level: cfg.escalationMinLevel || 'critical',
          escalation_user_id: cfg.escalationUserId || null,
          escalation_channel: cfg.escalationChannel || null,
          oncall_sync: {
            enabled: false,
            source_file: null,
            stale: true,
            error: 'scheduler policy sync unavailable'
          }
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/delivery/ownership-drift', async (req, res) => {
    try {
      const forceSync = req.query.sync === undefined
        ? true
        : String(req.query.sync).toLowerCase() !== 'false';

      const emitAudit = req.query.emitAudit === undefined
        ? true
        : String(req.query.emitAudit).toLowerCase() !== 'false';

      const routeEnabled = req.query.route === undefined
        ? String(process.env.ALERT_OWNER_DRIFT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false'
        : String(req.query.route).toLowerCase() !== 'false';

      const routeMinLevel = String(process.env.ALERT_OWNER_DRIFT_ROUTE_MIN_LEVEL || 'critical').toLowerCase();
      const levelRank = { info: 1, warn: 2, warning: 2, critical: 3 };

      if (!scheduler || typeof scheduler.getAlertRoutePolicy !== 'function') {
        return res.status(400).json({
          ok: false,
          reason: 'ownership_drift_not_supported'
        });
      }

      const policy = await scheduler.getAlertRoutePolicy({ forceSync });
      const drift = ownershipDriftDetector.computeDrift(policy);

      let routed = null;
      const shouldRoute = routeEnabled
        && drift.drift_detected
        && (levelRank[drift.level] || 1) >= (levelRank[routeMinLevel] || 3);

      if (shouldRoute) {
        const alert = {
          level: drift.level,
          should_notify: true,
          reasons: ['ownership_drift_detected', ...drift.reasons],
          metrics: {
            log: {
              window_minutes: null,
              failure_rate: null
            },
            outbox: {
              recent: {
                dead_letter: null
              }
            }
          },
          trend: {
            dead_letter_total: null,
            growth_streak: null
          }
        };

        routed = await alertRouter.routeDeliveryAlert(alert);
      }

      if (emitAudit && drift.drift_detected) {
        try {
          await db.logAgentAction(
            'delivery-alert',
            null,
            null,
            'ownership_drift_detected',
            null,
            'success',
            null,
            {
              level: drift.level,
              reasons: drift.reasons,
              sync: drift.sync,
              owners: drift.owners,
              policy_snapshot: drift.policy_snapshot,
              route: {
                enabled: routeEnabled,
                min_level: routeMinLevel,
                attempted: !!shouldRoute,
                routed
              }
            }
          );
        } catch (_e) {
          // best effort only
        }
      }

      res.json({
        ok: true,
        drift,
        policy,
        route: {
          enabled: routeEnabled,
          min_level: routeMinLevel,
          attempted: !!shouldRoute
        },
        routed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const event = req.query.event ? String(req.query.event).trim() : null;
      const level = req.query.level ? String(req.query.level).trim().toLowerCase() : null;
      const sinceMinutesRaw = req.query.sinceMinutes;
      const limit = Number(req.query.limit || 100);

      if (runId && !isUuid(runId)) {
        return badRequest(res, ['runId must be a valid UUID']);
      }

      if (event && !/^[a-z0-9_.:-]{2,120}$/i.test(event)) {
        return badRequest(res, ['event must be a valid event token']);
      }

      if (level && !['info', 'error', 'warn', 'debug'].includes(level)) {
        return badRequest(res, ['level must be one of info|warn|error|debug']);
      }

      let sinceMinutes = null;
      if (sinceMinutesRaw !== undefined) {
        sinceMinutes = Number(sinceMinutesRaw);
        if (!Number.isInteger(sinceMinutes) || sinceMinutes < 1 || sinceMinutes > 10080) {
          return badRequest(res, ['sinceMinutes must be an integer between 1 and 10080']);
        }
      }

      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        return badRequest(res, ['limit must be an integer between 1 and 1000']);
      }

      const events = await db.listDeployRunEvents({
        runId,
        event,
        level,
        sinceMinutes,
        limit
      });

      res.json({
        ok: true,
        filters: {
          runId,
          event,
          level,
          sinceMinutes,
          limit
        },
        count: events.length,
        events
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/summary', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 60);

      if (runId && !isUuid(runId)) {
        return badRequest(res, ['runId must be a valid UUID']);
      }

      if (!Number.isInteger(sinceMinutes) || sinceMinutes < 1 || sinceMinutes > 10080) {
        return badRequest(res, ['sinceMinutes must be an integer between 1 and 10080']);
      }

      const summary = await db.summarizeDeployRunEvents({
        runId,
        sinceMinutes
      });

      res.json({
        ok: true,
        filters: {
          runId,
          sinceMinutes
        },
        summary
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/trend', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 15);
      const runLimit = Number(req.query.runLimit || 50);
      const timelineLimit = Number(req.query.timelineLimit || 1000);
      const heatmapLimit = Number(req.query.heatmapLimit || 200);

      if (runId && !isUuid(runId)) {
        return badRequest(res, ['runId must be a valid UUID']);
      }

      if (source && !/^[a-z0-9_.:-]{2,80}$/i.test(source)) {
        return badRequest(res, ['source must be a valid source token']);
      }

      if (!Number.isInteger(sinceMinutes) || sinceMinutes < 1 || sinceMinutes > 10080) {
        return badRequest(res, ['sinceMinutes must be an integer between 1 and 10080']);
      }

      if (!Number.isInteger(bucketMinutes) || bucketMinutes < 1 || bucketMinutes > 1440) {
        return badRequest(res, ['bucketMinutes must be an integer between 1 and 1440']);
      }

      if (!Number.isInteger(runLimit) || runLimit < 1 || runLimit > 200) {
        return badRequest(res, ['runLimit must be an integer between 1 and 200']);
      }

      if (!Number.isInteger(timelineLimit) || timelineLimit < 1 || timelineLimit > 5000) {
        return badRequest(res, ['timelineLimit must be an integer between 1 and 5000']);
      }

      if (!Number.isInteger(heatmapLimit) || heatmapLimit < 1 || heatmapLimit > 1000) {
        return badRequest(res, ['heatmapLimit must be an integer between 1 and 1000']);
      }

      const [runs, timeline, heatmapRows] = await Promise.all([
        db.summarizeDeployRuns({
          sinceMinutes,
          runId,
          source,
          limit: runLimit
        }),
        db.getDeployEventTimeline({
          sinceMinutes,
          bucketMinutes,
          runId,
          source,
          limit: timelineLimit
        }),
        db.getDeployEventHeatmap({
          sinceMinutes,
          runId,
          source,
          limit: heatmapLimit
        })
      ]);

      const heatmapTotals = heatmapRows.reduce((acc, row) => {
        acc.total += Number(row.total_count || 0);
        acc.error += Number(row.error_count || 0);
        acc.warn += Number(row.warn_count || 0);
        acc.info += Number(row.info_count || 0);
        acc.debug += Number(row.debug_count || 0);
        return acc;
      }, { total: 0, error: 0, warn: 0, info: 0, debug: 0 });

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          runLimit,
          timelineLimit,
          heatmapLimit
        },
        runs,
        timeline,
        heatmap: {
          rows: heatmapRows,
          totals: heatmapTotals,
          peak_event: heatmapRows[0]?.event || null
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/delivery/alerts', async (req, res) => {
    try {
      const windowMinutes = Number(req.query.windowMinutes || 60);
      const limit = Number(req.query.limit || 500);
      const emitAudit = req.query.emitAudit === undefined
        ? true
        : String(req.query.emitAudit).toLowerCase() !== 'false';

      if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 10080) {
        return badRequest(res, ['windowMinutes must be an integer between 1 and 10080']);
      }

      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
        return badRequest(res, ['limit must be an integer between 1 and 5000']);
      }

      const result = await scheduler.evaluateDeliveryAlert({
        windowMinutes,
        limit,
        emitAudit
      });

      if (!result.ok && result.reason === 'delivery_alert_not_supported') {
        return res.status(400).json(result);
      }

      let routed = null;
      if (result.ok && result.should_notify) {
        if (result.alert_delivery) {
          routed = {
            routed: !!result.alert_delivery.dispatched,
            source: 'scheduler',
            delivery: result.alert_delivery.delivery,
            outbox: result.alert_delivery.outbox
          };
        } else {
          // fallback path for legacy/disabled scheduler routing
          routed = await alertRouter.routeDeliveryAlert(result);
        }
      }

      res.json({
        ...result,
        routed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/canary/drift', async (req, res) => {
    try {
      const historyFile = req.query.historyFile
        ? String(req.query.historyFile)
        : undefined;

      const minSamples = Number(req.query.minSamples || process.env.CANARY_PROFILE_MIN_SAMPLES || 5);
      if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 100000) {
        return badRequest(res, ['minSamples must be an integer between 1 and 100000']);
      }

      const routeEnabled = req.query.route === undefined
        ? String(process.env.CANARY_DRIFT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false'
        : String(req.query.route).toLowerCase() !== 'false';

      const emitAudit = req.query.emitAudit === undefined
        ? true
        : String(req.query.emitAudit).toLowerCase() !== 'false';

      const routeMinLevel = String(process.env.CANARY_DRIFT_ROUTE_MIN_LEVEL || 'warn').toLowerCase();
      const levelRank = { info: 1, warn: 2, warning: 2, critical: 3 };

      const resolvedHistoryFile = resolveHistoryFile({ historyFile });
      const history = await loadHistory(resolvedHistoryFile);
      const profile = computeSuggestedThresholds(history, { minSamples });

      const activeThresholds = {
        max_error_rate: Number(process.env.CANARY_MAX_ERROR_RATE ?? 0.2),
        max_p95_ms: Number(process.env.CANARY_P95_MAX_MS ?? 3500),
        max_avg_ms: Number(process.env.CANARY_AVG_MAX_MS ?? 2200)
      };

      const drift = canaryDriftDetector.evaluate({
        profile,
        activeThresholds,
        historyCount: history.length,
        historyFile: resolvedHistoryFile
      });

      let routed = null;
      const shouldRoute = routeEnabled
        && drift.should_notify
        && (levelRank[drift.level] || 1) >= (levelRank[routeMinLevel] || 2);

      if (shouldRoute) {
        const alert = {
          level: drift.level,
          should_notify: true,
          reasons: ['canary_profile_drift_detected', ...drift.reasons],
          metrics: {
            log: {
              window_minutes: null,
              failure_rate: null
            },
            outbox: {
              recent: {
                dead_letter: null
              }
            }
          },
          trend: {
            dead_letter_total: null,
            growth_streak: null
          }
        };

        routed = await alertRouter.routeDeliveryAlert(alert);
      }

      if (emitAudit && drift.drift_detected) {
        try {
          await db.logAgentAction(
            'canary-monitor',
            null,
            null,
            'canary_profile_drift_detected',
            null,
            'success',
            null,
            {
              drift,
              active_thresholds: activeThresholds,
              route_enabled: routeEnabled,
              route_min_level: routeMinLevel,
              routed
            }
          );
        } catch (_e) {
          // best effort
        }
      }

      res.json({
        ok: true,
        history_file: resolvedHistoryFile,
        history_count: history.length,
        profile,
        drift,
        route: {
          enabled: routeEnabled,
          min_level: routeMinLevel,
          attempted: !!shouldRoute
        },
        routed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/canary/drift-trend', async (req, res) => {
    try {
      const historyFile = req.query.historyFile
        ? String(req.query.historyFile)
        : undefined;

      const sinceMinutes = Number(req.query.sinceMinutes || process.env.CANARY_DRIFT_TREND_DEFAULT_SINCE_MINUTES || 1440);
      const bucketMinutes = Number(req.query.bucketMinutes || process.env.CANARY_DRIFT_TREND_DEFAULT_BUCKET_MINUTES || 60);
      const minSamples = Number(req.query.minSamples || process.env.CANARY_PROFILE_MIN_SAMPLES || 5);

      if (!Number.isInteger(sinceMinutes) || sinceMinutes < 1 || sinceMinutes > 10080) {
        return badRequest(res, ['sinceMinutes must be an integer between 1 and 10080']);
      }

      if (!Number.isInteger(bucketMinutes) || bucketMinutes < 1 || bucketMinutes > 1440) {
        return badRequest(res, ['bucketMinutes must be an integer between 1 and 1440']);
      }

      if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 100000) {
        return badRequest(res, ['minSamples must be an integer between 1 and 100000']);
      }

      const resolvedHistoryFile = resolveHistoryFile({ historyFile });
      const history = await loadHistory(resolvedHistoryFile);

      const activeThresholds = {
        max_error_rate: Number(process.env.CANARY_MAX_ERROR_RATE ?? 0.2),
        max_p95_ms: Number(process.env.CANARY_P95_MAX_MS ?? 3500),
        max_avg_ms: Number(process.env.CANARY_AVG_MAX_MS ?? 2200)
      };

      const trend = computeCanaryDriftTrend({
        history,
        activeThresholds,
        sinceMinutes,
        bucketMinutes,
        minSamples,
        warnRatio: Number(process.env.CANARY_DRIFT_WARN_RATIO ?? 0.25),
        criticalRatio: Number(process.env.CANARY_DRIFT_CRITICAL_RATIO ?? 0.5),
        historyFile: resolvedHistoryFile
      });

      res.json({
        ok: true,
        history_file: resolvedHistoryFile,
        trend
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
      const userId = req.query.userId ? String(req.query.userId).trim() : null;
      const olderThanMinutesRaw = req.query.olderThanMinutes;
      let olderThanMinutes = null;

      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return badRequest(res, ['limit must be an integer between 1 and 500']);
      }

      if (userId && !isUuid(userId)) {
        return badRequest(res, ['userId query parameter must be a valid UUID']);
      }

      if (olderThanMinutesRaw !== undefined) {
        olderThanMinutes = Number(olderThanMinutesRaw);
        if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1 || olderThanMinutes > 10080) {
          return badRequest(res, ['olderThanMinutes must be an integer between 1 and 10080']);
        }
      }

      const events = await db.getDeadLetterEvents({
        limit,
        eventType,
        userId,
        olderThanMinutes
      });

      res.json({
        ok: true,
        filters: {
          limit,
          eventType,
          userId,
          olderThanMinutes
        },
        count: events.length,
        events
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/dead-letter/replay-policy', async (req, res) => {
    try {
      const operator = extractReplayOperator(req);
      const approver = evaluateReplayApprover(operator);

      res.json({
        ok: true,
        policy: {
          maxLimit: deadLetterReplayPolicy.maxLimit,
          approvalThreshold: deadLetterReplayPolicy.approvalThreshold,
          requireApproval: deadLetterReplayPolicy.requireApproval,
          approvalCodeConfigured: !!deadLetterReplayPolicy.approvalCode,
          approverStrategy: deadLetterReplayPolicy.approverStrategy,
          approverAllowlistCount: deadLetterReplayPolicy.approverAllowlist.length,
          approverRolesCount: deadLetterReplayPolicy.approverRoles.length,
          approverPolicyEnforced: approver.policyEnforced
        },
        operator: {
          operatorId: operator.operatorId,
          operatorRole: operator.operatorRole,
          authorized: approver.authorized,
          policy_enforced: approver.policyEnforced,
          strategy: approver.strategy
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/jobs/dead-letter/replay-bulk', async (req, res) => {
    try {
      const limit = Number(req.body?.limit || 20);
      const eventType = req.body?.eventType || null;
      const userId = req.body?.userId ? String(req.body.userId).trim() : null;
      const olderThanMinutesRaw = req.body?.olderThanMinutes;
      const maxRetriesRaw = req.body?.maxRetries;
      const preview = req.body?.preview === true;
      const approve = req.body?.approve === true;
      const approvalCode = req.body?.approvalCode ? String(req.body.approvalCode) : null;
      const operator = extractReplayOperator(req);
      const approver = evaluateReplayApprover(operator);

      let olderThanMinutes;
      if (olderThanMinutesRaw !== undefined) {
        olderThanMinutes = Number(olderThanMinutesRaw);
        if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1 || olderThanMinutes > 10080) {
          return badRequest(res, ['olderThanMinutes must be an integer between 1 and 10080']);
        }
      }

      let maxRetries;
      if (maxRetriesRaw !== undefined) {
        maxRetries = Number(maxRetriesRaw);
        if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 20) {
          return badRequest(res, ['maxRetries must be an integer between 0 and 20']);
        }
      }

      if (!Number.isInteger(limit) || limit < 1 || limit > deadLetterReplayPolicy.maxLimit) {
        return badRequest(res, [`limit must be an integer between 1 and ${deadLetterReplayPolicy.maxLimit}`]);
      }

      if (userId && !isUuid(userId)) {
        return badRequest(res, ['userId must be a valid UUID']);
      }

      const broadScope = !eventType && !userId && !Number.isInteger(olderThanMinutes);
      const largeReplay = limit >= deadLetterReplayPolicy.approvalThreshold || broadScope;

      if (preview) {
        const events = await db.getDeadLetterEvents({
          limit,
          eventType,
          userId,
          olderThanMinutes
        });

        return res.json({
          ok: true,
          preview: true,
          policy: {
            maxLimit: deadLetterReplayPolicy.maxLimit,
            approvalThreshold: deadLetterReplayPolicy.approvalThreshold,
            requireApproval: deadLetterReplayPolicy.requireApproval,
            approvalCodeConfigured: !!deadLetterReplayPolicy.approvalCode,
            approverStrategy: deadLetterReplayPolicy.approverStrategy,
            approverAllowlistCount: deadLetterReplayPolicy.approverAllowlist.length,
            approverRolesCount: deadLetterReplayPolicy.approverRoles.length,
            approverPolicyEnforced: approver.policyEnforced
          },
          operator: {
            operatorId: operator.operatorId,
            operatorRole: operator.operatorRole,
            authorized: approver.authorized
          },
          requires_approval: deadLetterReplayPolicy.requireApproval && largeReplay,
          count: events.length,
          sample: events.slice(0, 10)
        });
      }

      if (deadLetterReplayPolicy.requireApproval && largeReplay) {
        const codeOk = !deadLetterReplayPolicy.approvalCode || approvalCode === deadLetterReplayPolicy.approvalCode;
        const blockers = [];

        if (!approve) blockers.push('approve_flag_missing');
        if (!codeOk) blockers.push('approval_code_invalid');
        if (!approver.authorized) blockers.push('operator_not_authorized');

        if (blockers.length > 0) {
          const reason = blockers.includes('operator_not_authorized')
            ? 'operator_not_authorized'
            : 'approval_required';

          try {
            await db.logAgentAction(
              'scheduler-replay',
              userId || null,
              null,
              'dead_letter_replay_blocked',
              null,
              'success',
              null,
              {
                reason,
                blockers,
                limit,
                eventType,
                userId,
                olderThanMinutes: Number.isInteger(olderThanMinutes) ? olderThanMinutes : null,
                operator,
                approver,
                policy: {
                  maxLimit: deadLetterReplayPolicy.maxLimit,
                  approvalThreshold: deadLetterReplayPolicy.approvalThreshold,
                  requireApproval: deadLetterReplayPolicy.requireApproval,
                  approvalCodeConfigured: !!deadLetterReplayPolicy.approvalCode,
                  approverStrategy: deadLetterReplayPolicy.approverStrategy,
                  approverAllowlistCount: deadLetterReplayPolicy.approverAllowlist.length,
                  approverRolesCount: deadLetterReplayPolicy.approverRoles.length
                }
              }
            );
          } catch (_e) {
            // best effort
          }

          return res.status(403).json({
            ok: false,
            reason,
            blockers,
            operator: {
              operatorId: operator.operatorId,
              operatorRole: operator.operatorRole,
              authorized: approver.authorized,
              policyEnforced: approver.policyEnforced,
              strategy: approver.strategy
            },
            policy: {
              maxLimit: deadLetterReplayPolicy.maxLimit,
              approvalThreshold: deadLetterReplayPolicy.approvalThreshold,
              requireApproval: deadLetterReplayPolicy.requireApproval,
              approvalCodeRequired: !!deadLetterReplayPolicy.approvalCode,
              approverStrategy: deadLetterReplayPolicy.approverStrategy,
              approverAllowlistCount: deadLetterReplayPolicy.approverAllowlist.length,
              approverRolesCount: deadLetterReplayPolicy.approverRoles.length,
              approverPolicyEnforced: approver.policyEnforced
            },
            hint: 'Set approve=true, provide approvalCode when configured, and include an authorized operatorId/operatorRole.'
          });
        }
      }

      const result = await scheduler.replayDeadLetterBatch({
        limit,
        eventType,
        userId,
        olderThanMinutes,
        maxRetries
      });

      if (result.reason === 'dead_letter_batch_not_supported') {
        return res.status(400).json(result);
      }

      res.json({
        ok: true,
        policy_applied: {
          largeReplay,
          approvalChecked: deadLetterReplayPolicy.requireApproval,
          operator: {
            operatorId: operator.operatorId,
            operatorRole: operator.operatorRole,
            authorized: approver.authorized,
            policyEnforced: approver.policyEnforced,
            strategy: approver.strategy
          }
        },
        result
      });
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

  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const forceCloseSockets = () => {
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch (_e) {
        // best effort
      }
    }
  };

  const closeServerGracefully = async () => {
    await new Promise((resolve) => {
      let resolved = false;

      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      server.close(done);
      setTimeout(() => {
        forceCloseSockets();
        done();
      }, gracefulShutdownMs);
    });
  };

  const shutdown = async ({ exit = false } = {}) => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        isShuttingDown = true;

        await closeServerGracefully();
        await Promise.allSettled([
          Promise.resolve().then(() => engine.close()),
          Promise.resolve().then(() => db.close())
        ]);
      })();
    }

    await shutdownPromise;
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
