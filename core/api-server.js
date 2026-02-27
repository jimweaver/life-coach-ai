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
const DeployTrendAnomalyDetector = require('./deploy-trend-anomaly');
const DeployTrendTelemetryAlertDetector = require('./deploy-trend-telemetry-alert');
const DeployTrendTelemetrySuppressionAlertDetector = require('./deploy-trend-telemetry-suppression-alert');
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
  const deployTrendAnomalyDetector = new DeployTrendAnomalyDetector();
  const deployTrendTelemetryAlertDetector = new DeployTrendTelemetryAlertDetector();
  const deployTrendTelemetrySuppressionAlertDetector = new DeployTrendTelemetrySuppressionAlertDetector();

  const ownerDriftLevelRank = { info: 1, warn: 2, warning: 2, critical: 3 };
  const canaryDriftLevelRank = { info: 1, warn: 2, warning: 2, critical: 3 };
  const deployTrendLevelRank = { info: 1, warn: 2, warning: 2, critical: 3 };

  const deployTrendRoutingPolicy = {
    routeEnabled: String(process.env.DEPLOY_TREND_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
    routeMinLevel: String(process.env.DEPLOY_TREND_ROUTE_MIN_LEVEL || 'warn').toLowerCase(),
    routeUserId: process.env.DEPLOY_TREND_ROUTE_USER_ID || null,
    routeChannel: process.env.DEPLOY_TREND_ROUTE_CHANNEL || 'cron-event',
    routeRetryMax: Number(process.env.DEPLOY_TREND_ROUTE_RETRY_MAX || 1),
    suppressionEnabled: String(process.env.DEPLOY_TREND_SUPPRESSION_ENABLED || 'true').toLowerCase() !== 'false',
    suppressionCooldownMinutes: Number(process.env.DEPLOY_TREND_SUPPRESSION_COOLDOWN_MINUTES || 30),
    suppressionDuplicateWindowMinutes: Number(process.env.DEPLOY_TREND_SUPPRESSION_DUPLICATE_WINDOW_MINUTES || 120),
    suppressionStateKey: process.env.DEPLOY_TREND_SUPPRESSION_STATE_KEY || 'lifecoach:deploy-trend:suppression',
    suppressionStateTtlSec: Number(process.env.DEPLOY_TREND_SUPPRESSION_STATE_TTL_SEC || 604800)
  };

  const deployTrendTelemetryAlertRoutingPolicy = {
    routeEnabled: String(process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
    routeMinLevel: String(process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_MIN_LEVEL || 'warn').toLowerCase(),
    routeUserId: process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_USER_ID || deployTrendRoutingPolicy.routeUserId || null,
    routeChannel: process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_CHANNEL || deployTrendRoutingPolicy.routeChannel || 'cron-event',
    routeRetryMax: Number(process.env.DEPLOY_TREND_TELEMETRY_ALERT_ROUTE_RETRY_MAX || deployTrendRoutingPolicy.routeRetryMax || 1),
    suppressionEnabled: String(process.env.DEPLOY_TREND_TELEMETRY_ALERT_SUPPRESSION_ENABLED || 'true').toLowerCase() !== 'false',
    suppressionCooldownMinutes: Number(process.env.DEPLOY_TREND_TELEMETRY_ALERT_COOLDOWN_MINUTES || 30),
    suppressionDuplicateWindowMinutes: Number(process.env.DEPLOY_TREND_TELEMETRY_ALERT_DUPLICATE_WINDOW_MINUTES || 120),
    suppressionStateKey: process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_KEY || 'lifecoach:deploy-trend-telemetry-alert:suppression',
    suppressionStateTtlSec: Number(process.env.DEPLOY_TREND_TELEMETRY_ALERT_STATE_TTL_SEC || 604800)
  };

  const deployTrendTelemetrySuppressionAlertRoutingPolicy = {
    routeEnabled: String(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
    routeMinLevel: String(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_MIN_LEVEL || 'warn').toLowerCase(),
    routeUserId: process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_USER_ID || deployTrendTelemetryAlertRoutingPolicy.routeUserId || null,
    routeChannel: process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_CHANNEL || deployTrendTelemetryAlertRoutingPolicy.routeChannel || 'cron-event',
    routeRetryMax: Number(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_ROUTE_RETRY_MAX || deployTrendTelemetryAlertRoutingPolicy.routeRetryMax || 1),
    suppressionEnabled: String(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_SUPPRESSION_ENABLED || 'true').toLowerCase() !== 'false',
    suppressionCooldownMinutes: Number(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_COOLDOWN_MINUTES || 30),
    suppressionDuplicateWindowMinutes: Number(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_DUPLICATE_WINDOW_MINUTES || 120),
    suppressionStateKey: process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_STATE_KEY || 'lifecoach:deploy-trend-telemetry-suppression-alert:suppression',
    suppressionStateTtlSec: Number(process.env.DEPLOY_TREND_TELEMETRY_SUPPRESSION_ALERT_STATE_TTL_SEC || 604800)
  };

  const ownershipDriftRoutingPolicy = {
    routeEnabled: String(process.env.ALERT_OWNER_DRIFT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
    routeMinLevel: String(process.env.ALERT_OWNER_DRIFT_ROUTE_MIN_LEVEL || 'critical').toLowerCase(),
    suppressionEnabled: String(process.env.ALERT_OWNER_DRIFT_SUPPRESSION_ENABLED || 'true').toLowerCase() !== 'false',
    suppressionCooldownMinutes: Number(process.env.ALERT_OWNER_DRIFT_COOLDOWN_MINUTES || 30),
    suppressionDuplicateWindowMinutes: Number(process.env.ALERT_OWNER_DRIFT_DUPLICATE_WINDOW_MINUTES || 180),
    suppressionStateKey: process.env.ALERT_OWNER_DRIFT_STATE_KEY || 'lifecoach:ownership-drift:route-state',
    suppressionStateTtlSec: Number(process.env.ALERT_OWNER_DRIFT_STATE_TTL_SEC || 604800)
  };

  const canaryDriftRoutingPolicy = {
    routeEnabled: String(process.env.CANARY_DRIFT_ROUTE_ENABLED || 'true').toLowerCase() !== 'false',
    routeMinLevel: String(process.env.CANARY_DRIFT_ROUTE_MIN_LEVEL || 'warn').toLowerCase(),
    suppressionEnabled: String(process.env.CANARY_DRIFT_SUPPRESSION_ENABLED || 'true').toLowerCase() !== 'false',
    suppressionCooldownMinutes: Number(process.env.CANARY_DRIFT_COOLDOWN_MINUTES || 30),
    suppressionDuplicateWindowMinutes: Number(process.env.CANARY_DRIFT_DUPLICATE_WINDOW_MINUTES || 180),
    suppressionStateKey: process.env.CANARY_DRIFT_STATE_KEY || 'lifecoach:canary-drift:route-state',
    suppressionStateTtlSec: Number(process.env.CANARY_DRIFT_STATE_TTL_SEC || 604800)
  };

  let ownershipDriftRouteStateMemory = {
    last_routed_at_ms: 0,
    last_signature: null,
    last_level: 'info'
  };

  let canaryDriftRouteStateMemory = {
    last_routed_at_ms: 0,
    last_signature: null,
    last_level: 'info'
  };

  let deployTrendRouteStateMemory = {
    last_routed_at_ms: 0,
    last_signature: null,
    last_level: 'info'
  };

  let deployTrendTelemetryAlertRouteStateMemory = {
    last_routed_at_ms: 0,
    last_signature: null,
    last_level: 'info'
  };

  let deployTrendTelemetrySuppressionAlertRouteStateMemory = {
    last_routed_at_ms: 0,
    last_signature: null,
    last_level: 'info'
  };

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

  const buildOwnershipDriftSignature = (drift) => {
    const level = String(drift?.level || 'info').toLowerCase();
    const reasons = Array.isArray(drift?.reasons)
      ? [...drift.reasons].map((r) => String(r).toLowerCase()).sort().join('|')
      : '';
    return `${level}:${reasons}`;
  };

  const loadOwnershipDriftRouteState = async () => {
    const key = ownershipDriftRoutingPolicy.suppressionStateKey;

    if (db.redis && key) {
      try {
        const raw = await db.redis.get(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            last_routed_at_ms: Number(parsed.last_routed_at_ms || 0),
            last_signature: parsed.last_signature || null,
            last_level: String(parsed.last_level || 'info').toLowerCase()
          };
        }
      } catch (_e) {
        // fallback to memory state
      }
    }

    return { ...ownershipDriftRouteStateMemory };
  };

  const saveOwnershipDriftRouteState = async (state) => {
    ownershipDriftRouteStateMemory = {
      last_routed_at_ms: Number(state?.last_routed_at_ms || 0),
      last_signature: state?.last_signature || null,
      last_level: String(state?.last_level || 'info').toLowerCase()
    };

    const key = ownershipDriftRoutingPolicy.suppressionStateKey;
    if (db.redis && key) {
      try {
        await db.redis.setex(
          key,
          Math.max(60, ownershipDriftRoutingPolicy.suppressionStateTtlSec),
          JSON.stringify(ownershipDriftRouteStateMemory)
        );
      } catch (_e) {
        // best effort
      }
    }
  };

  const evaluateOwnershipDriftSuppression = async (drift) => {
    const policy = ownershipDriftRoutingPolicy;

    if (!policy.suppressionEnabled) {
      return {
        enabled: false,
        suppressed: false,
        reason: null,
        signature: buildOwnershipDriftSignature(drift),
        state: await loadOwnershipDriftRouteState()
      };
    }

    const state = await loadOwnershipDriftRouteState();
    const nowMs = Date.now();
    const signature = buildOwnershipDriftSignature(drift);
    const currentLevel = String(drift?.level || 'info').toLowerCase();
    const currentRank = ownerDriftLevelRank[currentLevel] || 1;
    const lastRank = ownerDriftLevelRank[state.last_level] || 1;

    const duplicateWindowMs = Math.max(0, policy.suppressionDuplicateWindowMinutes) * 60_000;
    const cooldownMs = Math.max(0, policy.suppressionCooldownMinutes) * 60_000;

    const sinceLastMs = state.last_routed_at_ms > 0
      ? Math.max(0, nowMs - state.last_routed_at_ms)
      : null;

    const duplicateWithinWindow = state.last_signature
      && state.last_signature === signature
      && sinceLastMs !== null
      && sinceLastMs < duplicateWindowMs;

    const cooldownActive = sinceLastMs !== null
      && sinceLastMs < cooldownMs
      && currentRank <= lastRank;

    if (duplicateWithinWindow) {
      return {
        enabled: true,
        suppressed: true,
        reason: 'duplicate_within_window',
        signature,
        remaining_ms: Math.max(0, duplicateWindowMs - sinceLastMs),
        state
      };
    }

    if (cooldownActive) {
      return {
        enabled: true,
        suppressed: true,
        reason: 'cooldown_active',
        signature,
        remaining_ms: Math.max(0, cooldownMs - sinceLastMs),
        state
      };
    }

    return {
      enabled: true,
      suppressed: false,
      reason: null,
      signature,
      remaining_ms: 0,
      state
    };
  };

  const buildCanaryDriftSignature = (drift) => {
    const level = String(drift?.level || 'info').toLowerCase();
    const reasons = Array.isArray(drift?.reasons)
      ? [...drift.reasons].map((r) => String(r).toLowerCase()).sort().join('|')
      : '';

    const delta = drift?.drift_delta || {};
    const keys = ['max_error_rate', 'max_p95_ms', 'max_avg_ms'];
    const deltaPart = keys
      .map((k) => {
        const value = Number(delta[k]);
        return Number.isFinite(value) ? `${k}:${value.toFixed(4)}` : `${k}:na`;
      })
      .join('|');

    return `${level}:${reasons}:${deltaPart}`;
  };

  const loadCanaryDriftRouteState = async () => {
    const key = canaryDriftRoutingPolicy.suppressionStateKey;

    if (db.redis && key) {
      try {
        const raw = await db.redis.get(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            last_routed_at_ms: Number(parsed.last_routed_at_ms || 0),
            last_signature: parsed.last_signature || null,
            last_level: String(parsed.last_level || 'info').toLowerCase()
          };
        }
      } catch (_e) {
        // fallback to memory state
      }
    }

    return { ...canaryDriftRouteStateMemory };
  };

  const saveCanaryDriftRouteState = async (state) => {
    canaryDriftRouteStateMemory = {
      last_routed_at_ms: Number(state?.last_routed_at_ms || 0),
      last_signature: state?.last_signature || null,
      last_level: String(state?.last_level || 'info').toLowerCase()
    };

    const key = canaryDriftRoutingPolicy.suppressionStateKey;
    if (db.redis && key) {
      try {
        await db.redis.setex(
          key,
          Math.max(60, canaryDriftRoutingPolicy.suppressionStateTtlSec),
          JSON.stringify(canaryDriftRouteStateMemory)
        );
      } catch (_e) {
        // best effort
      }
    }
  };

  const evaluateCanaryDriftSuppression = async (drift) => {
    const policy = canaryDriftRoutingPolicy;

    if (!policy.suppressionEnabled) {
      return {
        enabled: false,
        suppressed: false,
        reason: null,
        signature: buildCanaryDriftSignature(drift),
        state: await loadCanaryDriftRouteState()
      };
    }

    const state = await loadCanaryDriftRouteState();
    const nowMs = Date.now();
    const signature = buildCanaryDriftSignature(drift);
    const currentLevel = String(drift?.level || 'info').toLowerCase();
    const currentRank = canaryDriftLevelRank[currentLevel] || 1;
    const lastRank = canaryDriftLevelRank[state.last_level] || 1;

    const duplicateWindowMs = Math.max(0, policy.suppressionDuplicateWindowMinutes) * 60_000;
    const cooldownMs = Math.max(0, policy.suppressionCooldownMinutes) * 60_000;

    const sinceLastMs = state.last_routed_at_ms > 0
      ? Math.max(0, nowMs - state.last_routed_at_ms)
      : null;

    const duplicateWithinWindow = state.last_signature
      && state.last_signature === signature
      && sinceLastMs !== null
      && sinceLastMs < duplicateWindowMs;

    const cooldownActive = sinceLastMs !== null
      && sinceLastMs < cooldownMs
      && currentRank <= lastRank;

    if (duplicateWithinWindow) {
      return {
        enabled: true,
        suppressed: true,
        reason: 'duplicate_within_window',
        signature,
        remaining_ms: Math.max(0, duplicateWindowMs - sinceLastMs),
        state
      };
    }

    if (cooldownActive) {
      return {
        enabled: true,
        suppressed: true,
        reason: 'cooldown_active',
        signature,
        remaining_ms: Math.max(0, cooldownMs - sinceLastMs),
        state
      };
    }

    return {
      enabled: true,
      suppressed: false,
      reason: null,
      signature,
      remaining_ms: 0,
      state
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

  const buildDeployTrendRouteSignature = (anomaly) => {
    const level = String(anomaly?.level || 'info').toLowerCase();
    const reasons = Array.isArray(anomaly?.reasons)
      ? [...new Set(anomaly.reasons.map((x) => String(x || '').trim()).filter(Boolean))].sort()
      : [];

    return JSON.stringify({ level, reasons });
  };

  const loadDeployTrendRouteState = async () => {
    if (!deployTrendRoutingPolicy.suppressionEnabled) {
      return {
        ...deployTrendRouteStateMemory,
        source: 'disabled'
      };
    }

    if (!db.redis || !deployTrendRoutingPolicy.suppressionStateKey) {
      return {
        ...deployTrendRouteStateMemory,
        source: 'memory'
      };
    }

    try {
      const raw = await db.redis.get(deployTrendRoutingPolicy.suppressionStateKey);
      if (!raw) {
        return {
          ...deployTrendRouteStateMemory,
          source: 'redis'
        };
      }

      const parsed = JSON.parse(raw);
      return {
        last_routed_at_ms: Number(parsed.last_routed_at_ms || 0),
        last_signature: parsed.last_signature || null,
        last_level: parsed.last_level || 'info',
        source: 'redis'
      };
    } catch (_e) {
      return {
        ...deployTrendRouteStateMemory,
        source: 'memory-fallback'
      };
    }
  };

  const saveDeployTrendRouteState = async (state) => {
    deployTrendRouteStateMemory = {
      last_routed_at_ms: Number(state.last_routed_at_ms || 0),
      last_signature: state.last_signature || null,
      last_level: state.last_level || 'info'
    };

    if (!deployTrendRoutingPolicy.suppressionEnabled) return;
    if (!db.redis || !deployTrendRoutingPolicy.suppressionStateKey) return;

    try {
      await db.redis.setex(
        deployTrendRoutingPolicy.suppressionStateKey,
        Math.max(60, deployTrendRoutingPolicy.suppressionStateTtlSec),
        JSON.stringify(deployTrendRouteStateMemory)
      );
    } catch (_e) {
      // best effort only
    }
  };

  const evaluateDeployTrendSuppression = async (anomaly) => {
    if (!deployTrendRoutingPolicy.suppressionEnabled) {
      return {
        enabled: false,
        suppressed: false,
        reason: 'suppression_disabled',
        remaining_ms: 0,
        duplicate_match: false,
        state: { ...deployTrendRouteStateMemory }
      };
    }

    const now = Date.now();
    const state = await loadDeployTrendRouteState();

    const cooldownMs = Math.max(0, deployTrendRoutingPolicy.suppressionCooldownMinutes) * 60_000;
    const duplicateWindowMs = Math.max(0, deployTrendRoutingPolicy.suppressionDuplicateWindowMinutes) * 60_000;

    const elapsedMs = Math.max(0, now - Number(state.last_routed_at_ms || 0));
    const currentSignature = buildDeployTrendRouteSignature(anomaly);
    const duplicateMatch = !!state.last_signature && state.last_signature === currentSignature;

    const inCooldown = Number(state.last_routed_at_ms || 0) > 0 && elapsedMs < cooldownMs;
    const inDuplicateWindow = duplicateMatch && Number(state.last_routed_at_ms || 0) > 0 && elapsedMs < duplicateWindowMs;

    let suppressed = false;
    let reason = 'allowed';
    let remainingMs = 0;

    if (inDuplicateWindow) {
      suppressed = true;
      reason = 'duplicate_window';
      remainingMs = Math.max(0, duplicateWindowMs - elapsedMs);
    } else if (inCooldown) {
      suppressed = true;
      reason = 'cooldown';
      remainingMs = Math.max(0, cooldownMs - elapsedMs);
    }

    return {
      enabled: true,
      suppressed,
      reason,
      remaining_ms: remainingMs,
      duplicate_match: duplicateMatch,
      current_signature: currentSignature,
      state
    };
  };

  const buildDeployTrendTelemetryAlertSignature = (alert) => {
    const level = String(alert?.level || 'info').toLowerCase();
    const reasons = Array.isArray(alert?.reasons)
      ? [...new Set(alert.reasons.map((x) => String(x || '').trim()).filter(Boolean))].sort()
      : [];

    return JSON.stringify({ level, reasons });
  };

  const loadDeployTrendTelemetryAlertRouteState = async () => {
    if (!deployTrendTelemetryAlertRoutingPolicy.suppressionEnabled) {
      return {
        ...deployTrendTelemetryAlertRouteStateMemory,
        source: 'disabled'
      };
    }

    if (!db.redis || !deployTrendTelemetryAlertRoutingPolicy.suppressionStateKey) {
      return {
        ...deployTrendTelemetryAlertRouteStateMemory,
        source: 'memory'
      };
    }

    try {
      const raw = await db.redis.get(deployTrendTelemetryAlertRoutingPolicy.suppressionStateKey);
      if (!raw) {
        return {
          ...deployTrendTelemetryAlertRouteStateMemory,
          source: 'redis'
        };
      }

      const parsed = JSON.parse(raw);
      return {
        last_routed_at_ms: Number(parsed.last_routed_at_ms || 0),
        last_signature: parsed.last_signature || null,
        last_level: parsed.last_level || 'info',
        source: 'redis'
      };
    } catch (_e) {
      return {
        ...deployTrendTelemetryAlertRouteStateMemory,
        source: 'memory-fallback'
      };
    }
  };

  const saveDeployTrendTelemetryAlertRouteState = async (state) => {
    deployTrendTelemetryAlertRouteStateMemory = {
      last_routed_at_ms: Number(state.last_routed_at_ms || 0),
      last_signature: state.last_signature || null,
      last_level: state.last_level || 'info'
    };

    if (!deployTrendTelemetryAlertRoutingPolicy.suppressionEnabled) return;
    if (!db.redis || !deployTrendTelemetryAlertRoutingPolicy.suppressionStateKey) return;

    try {
      await db.redis.setex(
        deployTrendTelemetryAlertRoutingPolicy.suppressionStateKey,
        Math.max(60, deployTrendTelemetryAlertRoutingPolicy.suppressionStateTtlSec),
        JSON.stringify(deployTrendTelemetryAlertRouteStateMemory)
      );
    } catch (_e) {
      // best effort only
    }
  };

  const evaluateDeployTrendTelemetryAlertSuppression = async (alert) => {
    if (!deployTrendTelemetryAlertRoutingPolicy.suppressionEnabled) {
      return {
        enabled: false,
        suppressed: false,
        reason: 'suppression_disabled',
        remaining_ms: 0,
        duplicate_match: false,
        state: { ...deployTrendTelemetryAlertRouteStateMemory }
      };
    }

    const now = Date.now();
    const state = await loadDeployTrendTelemetryAlertRouteState();

    const cooldownMs = Math.max(0, deployTrendTelemetryAlertRoutingPolicy.suppressionCooldownMinutes) * 60_000;
    const duplicateWindowMs = Math.max(0, deployTrendTelemetryAlertRoutingPolicy.suppressionDuplicateWindowMinutes) * 60_000;

    const elapsedMs = Math.max(0, now - Number(state.last_routed_at_ms || 0));
    const currentSignature = buildDeployTrendTelemetryAlertSignature(alert);
    const duplicateMatch = !!state.last_signature && state.last_signature === currentSignature;

    const inCooldown = Number(state.last_routed_at_ms || 0) > 0 && elapsedMs < cooldownMs;
    const inDuplicateWindow = duplicateMatch && Number(state.last_routed_at_ms || 0) > 0 && elapsedMs < duplicateWindowMs;

    let suppressed = false;
    let reason = 'allowed';
    let remainingMs = 0;

    if (inDuplicateWindow) {
      suppressed = true;
      reason = 'duplicate_window';
      remainingMs = Math.max(0, duplicateWindowMs - elapsedMs);
    } else if (inCooldown) {
      suppressed = true;
      reason = 'cooldown';
      remainingMs = Math.max(0, cooldownMs - elapsedMs);
    }

    return {
      enabled: true,
      suppressed,
      reason,
      remaining_ms: remainingMs,
      duplicate_match: duplicateMatch,
      current_signature: currentSignature,
      state
    };
  };

  const buildDeployTrendTelemetrySuppressionAlertSignature = (alert) => {
    const level = String(alert?.level || 'info').toLowerCase();
    const reasons = Array.isArray(alert?.reasons)
      ? [...new Set(alert.reasons.map((x) => String(x || '').trim()).filter(Boolean))].sort()
      : [];

    return JSON.stringify({ level, reasons });
  };

  const loadDeployTrendTelemetrySuppressionAlertRouteState = async () => {
    if (!deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionEnabled) {
      return {
        ...deployTrendTelemetrySuppressionAlertRouteStateMemory,
        source: 'disabled'
      };
    }

    if (!db.redis || !deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionStateKey) {
      return {
        ...deployTrendTelemetrySuppressionAlertRouteStateMemory,
        source: 'memory'
      };
    }

    try {
      const raw = await db.redis.get(deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionStateKey);
      if (!raw) {
        return {
          ...deployTrendTelemetrySuppressionAlertRouteStateMemory,
          source: 'redis'
        };
      }

      const parsed = JSON.parse(raw);
      return {
        last_routed_at_ms: Number(parsed.last_routed_at_ms || 0),
        last_signature: parsed.last_signature || null,
        last_level: parsed.last_level || 'info',
        source: 'redis'
      };
    } catch (_e) {
      return {
        ...deployTrendTelemetrySuppressionAlertRouteStateMemory,
        source: 'memory-fallback'
      };
    }
  };

  const saveDeployTrendTelemetrySuppressionAlertRouteState = async (state) => {
    deployTrendTelemetrySuppressionAlertRouteStateMemory = {
      last_routed_at_ms: Number(state.last_routed_at_ms || 0),
      last_signature: state.last_signature || null,
      last_level: state.last_level || 'info'
    };

    if (!deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionEnabled) return;
    if (!db.redis || !deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionStateKey) return;

    try {
      await db.redis.setex(
        deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionStateKey,
        Math.max(60, deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionStateTtlSec),
        JSON.stringify(deployTrendTelemetrySuppressionAlertRouteStateMemory)
      );
    } catch (_e) {
      // best effort only
    }
  };

  const evaluateDeployTrendTelemetrySuppressionAlertSuppression = async (alert) => {
    if (!deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionEnabled) {
      return {
        enabled: false,
        suppressed: false,
        reason: 'suppression_disabled',
        remaining_ms: 0,
        duplicate_match: false,
        state: { ...deployTrendTelemetrySuppressionAlertRouteStateMemory }
      };
    }

    const now = Date.now();
    const state = await loadDeployTrendTelemetrySuppressionAlertRouteState();

    const cooldownMs = Math.max(0, deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionCooldownMinutes) * 60_000;
    const duplicateWindowMs = Math.max(0, deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionDuplicateWindowMinutes) * 60_000;

    const elapsedMs = Math.max(0, now - Number(state.last_routed_at_ms || 0));
    const currentSignature = buildDeployTrendTelemetrySuppressionAlertSignature(alert);
    const duplicateMatch = !!state.last_signature && state.last_signature === currentSignature;

    const inCooldown = Number(state.last_routed_at_ms || 0) > 0 && elapsedMs < cooldownMs;
    const inDuplicateWindow = duplicateMatch && Number(state.last_routed_at_ms || 0) > 0 && elapsedMs < duplicateWindowMs;

    let suppressed = false;
    let reason = 'allowed';
    let remainingMs = 0;

    if (inDuplicateWindow) {
      suppressed = true;
      reason = 'duplicate_window';
      remainingMs = Math.max(0, duplicateWindowMs - elapsedMs);
    } else if (inCooldown) {
      suppressed = true;
      reason = 'cooldown';
      remainingMs = Math.max(0, cooldownMs - elapsedMs);
    }

    return {
      enabled: true,
      suppressed,
      reason,
      remaining_ms: remainingMs,
      duplicate_match: duplicateMatch,
      current_signature: currentSignature,
      state
    };
  };

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
        owner_drift_route_enabled: ownershipDriftRoutingPolicy.routeEnabled,
        owner_drift_route_min_level: ownershipDriftRoutingPolicy.routeMinLevel,
        owner_drift_suppression_enabled: ownershipDriftRoutingPolicy.suppressionEnabled,
        owner_drift_suppression_cooldown_minutes: ownershipDriftRoutingPolicy.suppressionCooldownMinutes,
        owner_drift_suppression_duplicate_window_minutes: ownershipDriftRoutingPolicy.suppressionDuplicateWindowMinutes,
        owner_drift_suppression_state_key_configured: !!ownershipDriftRoutingPolicy.suppressionStateKey
      },
      canary_drift_policy: {
        route_enabled: canaryDriftRoutingPolicy.routeEnabled,
        route_min_level: canaryDriftRoutingPolicy.routeMinLevel,
        suppression_enabled: canaryDriftRoutingPolicy.suppressionEnabled,
        suppression_cooldown_minutes: canaryDriftRoutingPolicy.suppressionCooldownMinutes,
        suppression_duplicate_window_minutes: canaryDriftRoutingPolicy.suppressionDuplicateWindowMinutes,
        suppression_state_key_configured: !!canaryDriftRoutingPolicy.suppressionStateKey,
        warn_ratio: Number(process.env.CANARY_DRIFT_WARN_RATIO || 0.25),
        critical_ratio: Number(process.env.CANARY_DRIFT_CRITICAL_RATIO || 0.5),
        profile_min_samples: Number(process.env.CANARY_PROFILE_MIN_SAMPLES || 5),
        trend_default_since_minutes: Number(process.env.CANARY_DRIFT_TREND_DEFAULT_SINCE_MINUTES || 1440),
        trend_default_bucket_minutes: Number(process.env.CANARY_DRIFT_TREND_DEFAULT_BUCKET_MINUTES || 60),
        history_file: resolveHistoryFile()
      },
      deploy_trend_anomaly_policy: {
        route_enabled: deployTrendRoutingPolicy.routeEnabled,
        route_min_level: deployTrendRoutingPolicy.routeMinLevel,
        route_user_id_configured: !!deployTrendRoutingPolicy.routeUserId,
        route_channel: deployTrendRoutingPolicy.routeChannel,
        route_retry_max: deployTrendRoutingPolicy.routeRetryMax,
        suppression_enabled: deployTrendRoutingPolicy.suppressionEnabled,
        suppression_cooldown_minutes: deployTrendRoutingPolicy.suppressionCooldownMinutes,
        suppression_duplicate_window_minutes: deployTrendRoutingPolicy.suppressionDuplicateWindowMinutes,
        suppression_state_key_configured: !!deployTrendRoutingPolicy.suppressionStateKey,
        warn_error_rate: deployTrendAnomalyDetector.warnErrorRate,
        critical_error_rate: deployTrendAnomalyDetector.criticalErrorRate,
        warn_abort_ratio: deployTrendAnomalyDetector.warnAbortRatio,
        critical_abort_ratio: deployTrendAnomalyDetector.criticalAbortRatio,
        warn_volume_spike: deployTrendAnomalyDetector.warnVolumeSpikeMultiplier,
        critical_volume_spike: deployTrendAnomalyDetector.criticalVolumeSpikeMultiplier,
        warn_duration_spike: deployTrendAnomalyDetector.warnDurationMultiplier,
        critical_duration_spike: deployTrendAnomalyDetector.criticalDurationMultiplier
      },
      deploy_trend_telemetry_alert_policy: {
        route_enabled: deployTrendTelemetryAlertRoutingPolicy.routeEnabled,
        route_min_level: deployTrendTelemetryAlertRoutingPolicy.routeMinLevel,
        route_user_id_configured: !!deployTrendTelemetryAlertRoutingPolicy.routeUserId,
        route_channel: deployTrendTelemetryAlertRoutingPolicy.routeChannel,
        route_retry_max: deployTrendTelemetryAlertRoutingPolicy.routeRetryMax,
        suppression_enabled: deployTrendTelemetryAlertRoutingPolicy.suppressionEnabled,
        suppression_cooldown_minutes: deployTrendTelemetryAlertRoutingPolicy.suppressionCooldownMinutes,
        suppression_duplicate_window_minutes: deployTrendTelemetryAlertRoutingPolicy.suppressionDuplicateWindowMinutes,
        suppression_state_key_configured: !!deployTrendTelemetryAlertRoutingPolicy.suppressionStateKey,
        warn_route_failure_rate: deployTrendTelemetryAlertDetector.warnRouteFailureRate,
        critical_route_failure_rate: deployTrendTelemetryAlertDetector.criticalRouteFailureRate,
        warn_suppression_rate: deployTrendTelemetryAlertDetector.warnSuppressionRate,
        critical_suppression_rate: deployTrendTelemetryAlertDetector.criticalSuppressionRate,
        warn_route_failure_spike: deployTrendTelemetryAlertDetector.warnRouteFailureSpike,
        critical_route_failure_spike: deployTrendTelemetryAlertDetector.criticalRouteFailureSpike,
        warn_suppression_spike: deployTrendTelemetryAlertDetector.warnSuppressionSpike,
        critical_suppression_spike: deployTrendTelemetryAlertDetector.criticalSuppressionSpike,
        min_detections: deployTrendTelemetryAlertDetector.minDetections,
        min_route_attempts: deployTrendTelemetryAlertDetector.minRouteAttempts,
        min_buckets: deployTrendTelemetryAlertDetector.minBuckets,
        baseline_buckets: deployTrendTelemetryAlertDetector.baselineBuckets
      },
      deploy_trend_telemetry_suppression_alert_policy: {
        route_enabled: deployTrendTelemetrySuppressionAlertRoutingPolicy.routeEnabled,
        route_min_level: deployTrendTelemetrySuppressionAlertRoutingPolicy.routeMinLevel,
        route_user_id_configured: !!deployTrendTelemetrySuppressionAlertRoutingPolicy.routeUserId,
        route_channel: deployTrendTelemetrySuppressionAlertRoutingPolicy.routeChannel,
        route_retry_max: deployTrendTelemetrySuppressionAlertRoutingPolicy.routeRetryMax,
        suppression_enabled: deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionEnabled,
        suppression_cooldown_minutes: deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionCooldownMinutes,
        suppression_duplicate_window_minutes: deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionDuplicateWindowMinutes,
        suppression_state_key_configured: !!deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionStateKey,
        warn_cooldown_share: deployTrendTelemetrySuppressionAlertDetector.warnCooldownShare,
        critical_cooldown_share: deployTrendTelemetrySuppressionAlertDetector.criticalCooldownShare,
        warn_duplicate_window_share: deployTrendTelemetrySuppressionAlertDetector.warnDuplicateWindowShare,
        critical_duplicate_window_share: deployTrendTelemetrySuppressionAlertDetector.criticalDuplicateWindowShare,
        warn_cooldown_spike: deployTrendTelemetrySuppressionAlertDetector.warnCooldownSpike,
        critical_cooldown_spike: deployTrendTelemetrySuppressionAlertDetector.criticalCooldownSpike,
        warn_duplicate_window_spike: deployTrendTelemetrySuppressionAlertDetector.warnDuplicateWindowSpike,
        critical_duplicate_window_spike: deployTrendTelemetrySuppressionAlertDetector.criticalDuplicateWindowSpike,
        min_suppressed: deployTrendTelemetrySuppressionAlertDetector.minSuppressed,
        min_buckets: deployTrendTelemetrySuppressionAlertDetector.minBuckets,
        baseline_buckets: deployTrendTelemetrySuppressionAlertDetector.baselineBuckets
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

  app.get('/jobs/delivery/ownership-drift/suppression', async (req, res) => {
    try {
      const forceSync = String(req.query.sync || 'true').toLowerCase() !== 'false';

      if (!scheduler || typeof scheduler.getAlertRoutePolicy !== 'function') {
        return res.status(400).json({
          ok: false,
          reason: 'ownership_drift_not_supported'
        });
      }

      const policy = await scheduler.getAlertRoutePolicy({ forceSync });
      const drift = ownershipDriftDetector.computeDrift(policy);
      const suppression = await evaluateOwnershipDriftSuppression(drift);

      res.json({
        ok: true,
        suppression,
        policy
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/delivery/canary-drift/suppression', async (req, res) => {
    try {
      const historyFile = req.query.historyFile
        ? String(req.query.historyFile)
        : undefined;

      const minSamples = Number(req.query.minSamples || process.env.CANARY_PROFILE_MIN_SAMPLES || 5);
      if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 100000) {
        return badRequest(res, ['minSamples must be an integer between 1 and 100000']);
      }

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

      const routeEnabled = canaryDriftRoutingPolicy.routeEnabled;
      const routeMinLevel = canaryDriftRoutingPolicy.routeMinLevel;
      const routeCandidate = routeEnabled
        && drift.should_notify
        && (canaryDriftLevelRank[drift.level] || 1) >= (canaryDriftLevelRank[routeMinLevel] || 2);

      let suppression = {
        enabled: !!canaryDriftRoutingPolicy.suppressionEnabled,
        suppressed: false,
        reason: routeCandidate ? null : 'route_not_candidate',
        signature: buildCanaryDriftSignature(drift),
        remaining_ms: 0,
        state: await loadCanaryDriftRouteState()
      };

      if (routeCandidate) {
        if (canaryDriftRoutingPolicy.suppressionEnabled) {
          suppression = await evaluateCanaryDriftSuppression(drift);
        } else {
          suppression = {
            enabled: false,
            suppressed: false,
            reason: 'suppression_disabled',
            signature: buildCanaryDriftSignature(drift),
            remaining_ms: 0,
            state: await loadCanaryDriftRouteState()
          };
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
          candidate: !!routeCandidate
        },
        suppression
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
        ? ownershipDriftRoutingPolicy.routeEnabled
        : String(req.query.route).toLowerCase() !== 'false';

      const routeMinLevel = String(req.query.routeMinLevel || ownershipDriftRoutingPolicy.routeMinLevel).toLowerCase();
      if (!['info', 'warn', 'warning', 'critical'].includes(routeMinLevel)) {
        return badRequest(res, ['routeMinLevel must be one of info|warn|critical']);
      }

      const suppressionEnabled = req.query.suppress === undefined
        ? ownershipDriftRoutingPolicy.suppressionEnabled
        : String(req.query.suppress).toLowerCase() !== 'false';

      if (!scheduler || typeof scheduler.getAlertRoutePolicy !== 'function') {
        return res.status(400).json({
          ok: false,
          reason: 'ownership_drift_not_supported'
        });
      }

      const policy = await scheduler.getAlertRoutePolicy({ forceSync });
      const drift = ownershipDriftDetector.computeDrift(policy);

      let routed = null;
      let suppression = {
        enabled: !!suppressionEnabled,
        suppressed: false,
        reason: null,
        remaining_ms: 0,
        signature: buildOwnershipDriftSignature(drift),
        state: await loadOwnershipDriftRouteState()
      };

      const routeCandidate = routeEnabled
        && drift.drift_detected
        && (ownerDriftLevelRank[drift.level] || 1) >= (ownerDriftLevelRank[routeMinLevel] || 3);

      if (routeCandidate && suppressionEnabled) {
        suppression = await evaluateOwnershipDriftSuppression(drift);
      }

      const shouldRoute = routeCandidate && !suppression.suppressed;

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

        await saveOwnershipDriftRouteState({
          last_routed_at_ms: Date.now(),
          last_signature: suppression.signature,
          last_level: String(drift.level || 'info').toLowerCase()
        });
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
                candidate: !!routeCandidate,
                attempted: !!shouldRoute,
                suppression,
                routed
              }
            }
          );

          if (routeCandidate && suppression.suppressed) {
            await db.logAgentAction(
              'delivery-alert',
              null,
              null,
              'ownership_drift_route_suppressed',
              null,
              'success',
              null,
              {
                level: drift.level,
                reasons: drift.reasons,
                suppression,
                route_enabled: routeEnabled,
                route_min_level: routeMinLevel
              }
            );
          }
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
          candidate: !!routeCandidate,
          attempted: !!shouldRoute,
          suppression
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

  app.get('/jobs/deploy-events/anomalies/telemetry', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const limit = Number(req.query.limit || 5000);

      if (runId && !isUuid(runId)) {
        return badRequest(res, ['runId must be a valid UUID']);
      }

      if (source && !/^[a-z0-9_.:-]{2,80}$/i.test(source)) {
        return badRequest(res, ['source must be a valid source token']);
      }

      if (!Number.isInteger(sinceMinutes) || sinceMinutes < 1 || sinceMinutes > 10080) {
        return badRequest(res, ['sinceMinutes must be an integer between 1 and 10080']);
      }

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      const telemetry = await db.getDeployTrendAnomalyTelemetry({
        sinceMinutes,
        runId,
        source,
        limit
      });

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          limit
        },
        telemetry
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/telemetry/trend', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 60);
      const limit = Number(req.query.limit || 5000);
      const bucketLimit = Number(req.query.bucketLimit || 500);

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

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      if (!Number.isInteger(bucketLimit) || bucketLimit < 1 || bucketLimit > 5000) {
        return badRequest(res, ['bucketLimit must be an integer between 1 and 5000']);
      }

      const trend = await db.getDeployTrendAnomalyTelemetryTrend({
        sinceMinutes,
        bucketMinutes,
        runId,
        source,
        limit,
        bucketLimit
      });

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          limit,
          bucketLimit
        },
        trend
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/telemetry/alerts', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 60);
      const limit = Number(req.query.limit || 5000);
      const bucketLimit = Number(req.query.bucketLimit || 500);

      const emitAudit = req.query.emitAudit === undefined
        ? true
        : String(req.query.emitAudit).toLowerCase() !== 'false';

      const routeEnabled = req.query.route === undefined
        ? deployTrendTelemetryAlertRoutingPolicy.routeEnabled
        : String(req.query.route).toLowerCase() !== 'false';

      const routeMinLevel = String(req.query.routeMinLevel || deployTrendTelemetryAlertRoutingPolicy.routeMinLevel).toLowerCase();
      if (!['info', 'warn', 'warning', 'critical'].includes(routeMinLevel)) {
        return badRequest(res, ['routeMinLevel must be one of info|warn|warning|critical']);
      }

      const routeUserId = req.query.routeUserId
        ? String(req.query.routeUserId).trim()
        : deployTrendTelemetryAlertRoutingPolicy.routeUserId;

      const routeChannel = req.query.routeChannel
        ? String(req.query.routeChannel).trim()
        : deployTrendTelemetryAlertRoutingPolicy.routeChannel;

      if (routeUserId && !isUuid(routeUserId)) {
        return badRequest(res, ['routeUserId must be a valid UUID']);
      }

      const routeRetryMax = req.query.routeRetryMax === undefined
        ? deployTrendTelemetryAlertRoutingPolicy.routeRetryMax
        : Number(req.query.routeRetryMax);

      if (!Number.isInteger(routeRetryMax) || routeRetryMax < 0 || routeRetryMax > 10) {
        return badRequest(res, ['routeRetryMax must be an integer between 0 and 10']);
      }

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

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      if (!Number.isInteger(bucketLimit) || bucketLimit < 1 || bucketLimit > 5000) {
        return badRequest(res, ['bucketLimit must be an integer between 1 and 5000']);
      }

      const trend = await db.getDeployTrendAnomalyTelemetryTrend({
        sinceMinutes,
        bucketMinutes,
        runId,
        source,
        limit,
        bucketLimit
      });

      const alert = deployTrendTelemetryAlertDetector.evaluate({ trend });

      const routeCandidate = routeEnabled
        && alert.should_notify
        && (deployTrendLevelRank[alert.level] || 1) >= (deployTrendLevelRank[routeMinLevel] || 2);

      const suppression = routeCandidate
        ? await evaluateDeployTrendTelemetryAlertSuppression(alert)
        : {
          enabled: !!deployTrendTelemetryAlertRoutingPolicy.suppressionEnabled,
          suppressed: false,
          reason: 'route_not_candidate',
          remaining_ms: 0,
          duplicate_match: false,
          current_signature: null,
          state: await loadDeployTrendTelemetryAlertRouteState()
        };

      const routeBlockedBySuppression = routeCandidate && suppression?.suppressed === true;

      let routed = null;
      if (routeCandidate && !routeBlockedBySuppression) {
        const reasonsText = Array.isArray(alert.reasons) && alert.reasons.length
          ? alert.reasons.join(', ')
          : 'n/a';

        const messageText = [
          `[Deploy Trend Telemetry Alert][${alert.level}]`,
          `reasons=${reasonsText}`,
          `runId=${runId || 'all'}`,
          `source=${source || 'all'}`,
          `window=${sinceMinutes}m`,
          `bucket=${bucketMinutes}m`
        ].join(' ');

        routed = await alertRouter.route({
          kind: 'deploy_trend_telemetry_alert',
          level: alert.level,
          text: messageText,
          metadata: {
            filters: {
              runId,
              source,
              sinceMinutes,
              bucketMinutes,
              limit,
              bucketLimit
            },
            trend_summary: {
              sample_size: trend.sample_size,
              bucket_count: trend.bucket_count
            },
            suppression: {
              enabled: suppression?.enabled,
              suppressed: false,
              reason: suppression?.reason || 'allowed',
              remaining_ms: suppression?.remaining_ms || 0,
              duplicate_match: !!suppression?.duplicate_match,
              state: suppression?.state || null
            },
            alert
          },
          options: {
            toUserId: routeUserId,
            channel: routeChannel,
            retryMax: routeRetryMax
          }
        });
      }

      const routeAttempted = routeCandidate && !routeBlockedBySuppression && !!routed;

      if (routeAttempted) {
        await saveDeployTrendTelemetryAlertRouteState({
          last_routed_at_ms: Date.now(),
          last_signature: suppression.current_signature || buildDeployTrendTelemetryAlertSignature(alert),
          last_level: alert.level || 'info'
        });
      }

      if (emitAudit && routeBlockedBySuppression) {
        try {
          await db.logAgentAction(
            'deploy-trend',
            null,
            null,
            'deploy_trend_telemetry_alert_route_suppressed',
            null,
            'success',
            null,
            {
              filters: {
                runId,
                source,
                sinceMinutes,
                bucketMinutes,
                limit,
                bucketLimit
              },
              alert,
              suppression,
              route: {
                enabled: routeEnabled,
                min_level: routeMinLevel,
                candidate: true,
                suppressed: true,
                target_user_id: routeUserId || null,
                target_channel: routeChannel,
                route_retry_max: routeRetryMax
              }
            }
          );
        } catch (_e) {
          // best effort only
        }
      }

      if (emitAudit && alert.alert_detected) {
        try {
          await db.logAgentAction(
            'deploy-trend',
            null,
            null,
            'deploy_trend_telemetry_alert_detected',
            null,
            'success',
            null,
            {
              filters: {
                runId,
                source,
                sinceMinutes,
                bucketMinutes,
                limit,
                bucketLimit
              },
              trend_summary: {
                sample_size: trend.sample_size,
                bucket_count: trend.bucket_count
              },
              alert,
              route: {
                enabled: routeEnabled,
                min_level: routeMinLevel,
                candidate: !!routeCandidate,
                attempted: !!routeAttempted,
                suppressed: !!routeBlockedBySuppression,
                suppression,
                routed,
                target_user_id: routeUserId || null,
                target_channel: routeChannel,
                route_retry_max: routeRetryMax
              }
            }
          );
        } catch (_e) {
          // best effort only
        }
      }

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          limit,
          bucketLimit
        },
        trend,
        alert,
        route: {
          enabled: routeEnabled,
          min_level: routeMinLevel,
          candidate: !!routeCandidate,
          attempted: !!routeAttempted,
          suppressed: !!routeBlockedBySuppression,
          target_user_id: routeUserId || null,
          target_channel: routeChannel,
          retry_max: routeRetryMax
        },
        suppression,
        routed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/telemetry/alerts/suppression', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 60);
      const limit = Number(req.query.limit || 5000);
      const bucketLimit = Number(req.query.bucketLimit || 500);

      const routeEnabled = req.query.route === undefined
        ? deployTrendTelemetryAlertRoutingPolicy.routeEnabled
        : String(req.query.route).toLowerCase() !== 'false';

      const routeMinLevel = String(req.query.routeMinLevel || deployTrendTelemetryAlertRoutingPolicy.routeMinLevel).toLowerCase();
      if (!['info', 'warn', 'warning', 'critical'].includes(routeMinLevel)) {
        return badRequest(res, ['routeMinLevel must be one of info|warn|warning|critical']);
      }

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

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      if (!Number.isInteger(bucketLimit) || bucketLimit < 1 || bucketLimit > 5000) {
        return badRequest(res, ['bucketLimit must be an integer between 1 and 5000']);
      }

      const trend = await db.getDeployTrendAnomalyTelemetryTrend({
        sinceMinutes,
        bucketMinutes,
        runId,
        source,
        limit,
        bucketLimit
      });

      const alert = deployTrendTelemetryAlertDetector.evaluate({ trend });

      const routeCandidate = routeEnabled
        && alert.should_notify
        && (deployTrendLevelRank[alert.level] || 1) >= (deployTrendLevelRank[routeMinLevel] || 2);

      const suppression = routeCandidate
        ? await evaluateDeployTrendTelemetryAlertSuppression(alert)
        : {
          enabled: !!deployTrendTelemetryAlertRoutingPolicy.suppressionEnabled,
          suppressed: false,
          reason: 'route_not_candidate',
          remaining_ms: 0,
          duplicate_match: false,
          current_signature: buildDeployTrendTelemetryAlertSignature(alert),
          state: await loadDeployTrendTelemetryAlertRouteState()
        };

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          limit,
          bucketLimit
        },
        route: {
          enabled: routeEnabled,
          min_level: routeMinLevel,
          candidate: !!routeCandidate
        },
        suppression,
        alert: {
          level: alert.level,
          alert_detected: alert.alert_detected,
          reasons: alert.reasons,
          metrics: alert.metrics
        },
        trend_summary: {
          sample_size: trend.sample_size,
          bucket_count: trend.bucket_count,
          bucket_minutes: trend.bucket_minutes,
          latest_bucket: Array.isArray(trend.buckets) && trend.buckets.length
            ? trend.buckets[trend.buckets.length - 1]
            : null
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/telemetry/alerts/suppression/trend', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 60);
      const limit = Number(req.query.limit || 5000);
      const bucketLimit = Number(req.query.bucketLimit || 500);

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

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      if (!Number.isInteger(bucketLimit) || bucketLimit < 1 || bucketLimit > 5000) {
        return badRequest(res, ['bucketLimit must be an integer between 1 and 5000']);
      }

      const trend = await db.getDeployTrendTelemetryAlertSuppressionTrend({
        sinceMinutes,
        bucketMinutes,
        runId,
        source,
        limit,
        bucketLimit
      });

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          limit,
          bucketLimit
        },
        policy: {
          suppression_enabled: deployTrendTelemetryAlertRoutingPolicy.suppressionEnabled,
          suppression_cooldown_minutes: deployTrendTelemetryAlertRoutingPolicy.suppressionCooldownMinutes,
          suppression_duplicate_window_minutes: deployTrendTelemetryAlertRoutingPolicy.suppressionDuplicateWindowMinutes,
          suppression_state_key_configured: !!deployTrendTelemetryAlertRoutingPolicy.suppressionStateKey
        },
        trend
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/telemetry/alerts/suppression/anomalies', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 60);
      const limit = Number(req.query.limit || 5000);
      const bucketLimit = Number(req.query.bucketLimit || 500);

      const emitAudit = req.query.emitAudit === undefined
        ? true
        : String(req.query.emitAudit).toLowerCase() !== 'false';

      const routeEnabled = req.query.route === undefined
        ? deployTrendTelemetrySuppressionAlertRoutingPolicy.routeEnabled
        : String(req.query.route).toLowerCase() !== 'false';

      const routeMinLevel = String(req.query.routeMinLevel || deployTrendTelemetrySuppressionAlertRoutingPolicy.routeMinLevel).toLowerCase();
      if (!['info', 'warn', 'warning', 'critical'].includes(routeMinLevel)) {
        return badRequest(res, ['routeMinLevel must be one of info|warn|warning|critical']);
      }

      const routeUserId = req.query.routeUserId
        ? String(req.query.routeUserId).trim()
        : deployTrendTelemetrySuppressionAlertRoutingPolicy.routeUserId;

      const routeChannel = req.query.routeChannel
        ? String(req.query.routeChannel).trim()
        : deployTrendTelemetrySuppressionAlertRoutingPolicy.routeChannel;

      if (routeUserId && !isUuid(routeUserId)) {
        return badRequest(res, ['routeUserId must be a valid UUID']);
      }

      const routeRetryMax = req.query.routeRetryMax === undefined
        ? deployTrendTelemetrySuppressionAlertRoutingPolicy.routeRetryMax
        : Number(req.query.routeRetryMax);

      if (!Number.isInteger(routeRetryMax) || routeRetryMax < 0 || routeRetryMax > 10) {
        return badRequest(res, ['routeRetryMax must be an integer between 0 and 10']);
      }

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

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      if (!Number.isInteger(bucketLimit) || bucketLimit < 1 || bucketLimit > 5000) {
        return badRequest(res, ['bucketLimit must be an integer between 1 and 5000']);
      }

      const trend = await db.getDeployTrendTelemetryAlertSuppressionTrend({
        sinceMinutes,
        bucketMinutes,
        runId,
        source,
        limit,
        bucketLimit
      });

      const alert = deployTrendTelemetrySuppressionAlertDetector.evaluate({ trend });

      const routeCandidate = routeEnabled
        && alert.should_notify
        && (deployTrendLevelRank[alert.level] || 1) >= (deployTrendLevelRank[routeMinLevel] || 2);

      const suppression = routeCandidate
        ? await evaluateDeployTrendTelemetrySuppressionAlertSuppression(alert)
        : {
          enabled: !!deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionEnabled,
          suppressed: false,
          reason: 'route_not_candidate',
          remaining_ms: 0,
          duplicate_match: false,
          current_signature: null,
          state: await loadDeployTrendTelemetrySuppressionAlertRouteState()
        };

      const routeBlockedBySuppression = routeCandidate && suppression?.suppressed === true;

      let routed = null;
      if (routeCandidate && !routeBlockedBySuppression) {
        const reasonsText = Array.isArray(alert.reasons) && alert.reasons.length
          ? alert.reasons.join(', ')
          : 'n/a';

        const messageText = [
          `[Deploy Trend Telemetry Suppression Alert][${alert.level}]`,
          `reasons=${reasonsText}`,
          `runId=${runId || 'all'}`,
          `source=${source || 'all'}`,
          `window=${sinceMinutes}m`,
          `bucket=${bucketMinutes}m`
        ].join(' ');

        routed = await alertRouter.route({
          kind: 'deploy_trend_telemetry_suppression_alert',
          level: alert.level,
          text: messageText,
          metadata: {
            filters: {
              runId,
              source,
              sinceMinutes,
              bucketMinutes,
              limit,
              bucketLimit
            },
            trend_summary: {
              sample_size: trend.sample_size,
              bucket_count: trend.bucket_count,
              totals: trend.totals
            },
            suppression: {
              enabled: suppression?.enabled,
              suppressed: false,
              reason: suppression?.reason || 'allowed',
              remaining_ms: suppression?.remaining_ms || 0,
              duplicate_match: !!suppression?.duplicate_match,
              state: suppression?.state || null
            },
            alert
          },
          options: {
            toUserId: routeUserId,
            channel: routeChannel,
            retryMax: routeRetryMax
          }
        });
      }

      const routeAttempted = routeCandidate && !routeBlockedBySuppression && !!routed;

      if (routeAttempted) {
        await saveDeployTrendTelemetrySuppressionAlertRouteState({
          last_routed_at_ms: Date.now(),
          last_signature: suppression.current_signature || buildDeployTrendTelemetrySuppressionAlertSignature(alert),
          last_level: alert.level || 'info'
        });
      }

      if (emitAudit && routeBlockedBySuppression) {
        try {
          await db.logAgentAction(
            'deploy-trend',
            null,
            null,
            'deploy_trend_telemetry_suppression_alert_route_suppressed',
            null,
            'success',
            null,
            {
              filters: {
                runId,
                source,
                sinceMinutes,
                bucketMinutes,
                limit,
                bucketLimit
              },
              alert,
              suppression,
              route: {
                enabled: routeEnabled,
                min_level: routeMinLevel,
                candidate: true,
                suppressed: true,
                target_user_id: routeUserId || null,
                target_channel: routeChannel,
                route_retry_max: routeRetryMax
              }
            }
          );
        } catch (_e) {
          // best effort only
        }
      }

      if (emitAudit && alert.alert_detected) {
        try {
          await db.logAgentAction(
            'deploy-trend',
            null,
            null,
            'deploy_trend_telemetry_suppression_alert_detected',
            null,
            'success',
            null,
            {
              filters: {
                runId,
                source,
                sinceMinutes,
                bucketMinutes,
                limit,
                bucketLimit
              },
              trend_summary: {
                sample_size: trend.sample_size,
                bucket_count: trend.bucket_count,
                totals: trend.totals
              },
              alert,
              route: {
                enabled: routeEnabled,
                min_level: routeMinLevel,
                candidate: !!routeCandidate,
                attempted: !!routeAttempted,
                suppressed: !!routeBlockedBySuppression,
                suppression,
                routed,
                target_user_id: routeUserId || null,
                target_channel: routeChannel,
                route_retry_max: routeRetryMax
              }
            }
          );
        } catch (_e) {
          // best effort only
        }
      }

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          limit,
          bucketLimit
        },
        trend,
        alert,
        route: {
          enabled: routeEnabled,
          min_level: routeMinLevel,
          candidate: !!routeCandidate,
          attempted: !!routeAttempted,
          suppressed: !!routeBlockedBySuppression,
          target_user_id: routeUserId || null,
          target_channel: routeChannel,
          retry_max: routeRetryMax
        },
        suppression,
        routed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/telemetry/alerts/suppression/anomalies/suppression', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 60);
      const limit = Number(req.query.limit || 5000);
      const bucketLimit = Number(req.query.bucketLimit || 500);

      const routeEnabled = req.query.route === undefined
        ? deployTrendTelemetrySuppressionAlertRoutingPolicy.routeEnabled
        : String(req.query.route).toLowerCase() !== 'false';

      const routeMinLevel = String(req.query.routeMinLevel || deployTrendTelemetrySuppressionAlertRoutingPolicy.routeMinLevel).toLowerCase();
      if (!['info', 'warn', 'warning', 'critical'].includes(routeMinLevel)) {
        return badRequest(res, ['routeMinLevel must be one of info|warn|warning|critical']);
      }

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

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      if (!Number.isInteger(bucketLimit) || bucketLimit < 1 || bucketLimit > 5000) {
        return badRequest(res, ['bucketLimit must be an integer between 1 and 5000']);
      }

      const trend = await db.getDeployTrendTelemetryAlertSuppressionTrend({
        sinceMinutes,
        bucketMinutes,
        runId,
        source,
        limit,
        bucketLimit
      });

      const alert = deployTrendTelemetrySuppressionAlertDetector.evaluate({ trend });

      const routeCandidate = routeEnabled
        && alert.should_notify
        && (deployTrendLevelRank[alert.level] || 1) >= (deployTrendLevelRank[routeMinLevel] || 2);

      const suppression = routeCandidate
        ? await evaluateDeployTrendTelemetrySuppressionAlertSuppression(alert)
        : {
          enabled: !!deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionEnabled,
          suppressed: false,
          reason: 'route_not_candidate',
          remaining_ms: 0,
          duplicate_match: false,
          current_signature: buildDeployTrendTelemetrySuppressionAlertSignature(alert),
          state: await loadDeployTrendTelemetrySuppressionAlertRouteState()
        };

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          limit,
          bucketLimit
        },
        route: {
          enabled: routeEnabled,
          min_level: routeMinLevel,
          candidate: !!routeCandidate
        },
        suppression,
        alert: {
          level: alert.level,
          alert_detected: alert.alert_detected,
          reasons: alert.reasons,
          metrics: alert.metrics
        },
        trend_summary: {
          sample_size: trend.sample_size,
          bucket_count: trend.bucket_count,
          bucket_minutes: trend.bucket_minutes,
          latest_bucket: Array.isArray(trend.buckets) && trend.buckets.length
            ? trend.buckets[trend.buckets.length - 1]
            : null
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/telemetry/alerts/suppression/anomalies/suppression/trend', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 60);
      const limit = Number(req.query.limit || 5000);
      const bucketLimit = Number(req.query.bucketLimit || 500);

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

      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        return badRequest(res, ['limit must be an integer between 1 and 20000']);
      }

      if (!Number.isInteger(bucketLimit) || bucketLimit < 1 || bucketLimit > 5000) {
        return badRequest(res, ['bucketLimit must be an integer between 1 and 5000']);
      }

      const trend = await db.getDeployTrendTelemetrySuppressionAlertRouteSuppressionTrend({
        sinceMinutes,
        bucketMinutes,
        runId,
        source,
        limit,
        bucketLimit
      });

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          limit,
          bucketLimit
        },
        policy: {
          suppression_enabled: deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionEnabled,
          suppression_cooldown_minutes: deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionCooldownMinutes,
          suppression_duplicate_window_minutes: deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionDuplicateWindowMinutes,
          suppression_state_key_configured: !!deployTrendTelemetrySuppressionAlertRoutingPolicy.suppressionStateKey
        },
        trend
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 15);
      const runLimit = Number(req.query.runLimit || 100);
      const timelineLimit = Number(req.query.timelineLimit || 2000);
      const heatmapLimit = Number(req.query.heatmapLimit || 500);
      const emitAudit = req.query.emitAudit === undefined
        ? true
        : String(req.query.emitAudit).toLowerCase() !== 'false';
      const route = req.query.route === undefined
        ? deployTrendRoutingPolicy.routeEnabled
        : String(req.query.route).toLowerCase() !== 'false';

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

      if (!Number.isInteger(runLimit) || runLimit < 1 || runLimit > 500) {
        return badRequest(res, ['runLimit must be an integer between 1 and 500']);
      }

      if (!Number.isInteger(timelineLimit) || timelineLimit < 1 || timelineLimit > 10000) {
        return badRequest(res, ['timelineLimit must be an integer between 1 and 10000']);
      }

      if (!Number.isInteger(heatmapLimit) || heatmapLimit < 1 || heatmapLimit > 2000) {
        return badRequest(res, ['heatmapLimit must be an integer between 1 and 2000']);
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

      const anomaly = deployTrendAnomalyDetector.evaluate({
        runs,
        timeline,
        heatmapRows
      });

      if (emitAudit && anomaly.anomaly_detected) {
        try {
          await db.logAgentAction(
            'deploy-trend',
            null,
            null,
            'deploy_trend_anomaly_detected',
            null,
            'success',
            null,
            {
              level: anomaly.level,
              reasons: anomaly.reasons,
              anomaly_count: anomaly.anomaly_count,
              filters: {
                runId,
                source,
                sinceMinutes,
                bucketMinutes
              },
              metrics: anomaly.metrics,
              anomalies: anomaly.anomalies.slice(0, 10)
            }
          );
        } catch (_e) {
          // best effort only
        }
      }

      let routed = null;
      const routeMinLevel = String(req.query.routeMinLevel || deployTrendRoutingPolicy.routeMinLevel).toLowerCase();
      const routeRank = deployTrendLevelRank[routeMinLevel] || deployTrendLevelRank.warn;
      const shouldRoute = route && anomaly.anomaly_detected && (deployTrendLevelRank[anomaly.level] || 0) >= routeRank;
      const suppression = await evaluateDeployTrendSuppression(anomaly);
      const routeSuppressed = shouldRoute && suppression.enabled && suppression.suppressed;

      if (shouldRoute && !routeSuppressed) {
        const targetUserId = req.query.routeUserId
          ? String(req.query.routeUserId)
          : deployTrendRoutingPolicy.routeUserId;
        const targetChannel = req.query.routeChannel
          ? String(req.query.routeChannel)
          : deployTrendRoutingPolicy.routeChannel;

        if (!targetUserId) {
          routed = {
            attempted: false,
            routed: false,
            reason: 'route_target_not_configured',
            policy: {
              route_enabled: route,
              route_min_level: routeMinLevel,
              route_user_id_configured: !!deployTrendRoutingPolicy.routeUserId,
              route_channel: targetChannel,
              route_retry_max: deployTrendRoutingPolicy.routeRetryMax
            }
          };
        } else {
          const reasonsText = anomaly.reasons.slice(0, 3).join(', ');
          const alertText = [
            '🚨 Deploy Trend Anomaly',
            `Level: ${String(anomaly.level).toUpperCase()}`,
            `Reasons: ${reasonsText || 'n/a'}`,
            `Window: ${sinceMinutes}m`,
            `Anomalies: ${anomaly.anomaly_count}`
          ].join('\n');

          routed = await alertRouter.route({
            kind: 'deploy_trend_anomaly',
            level: anomaly.level,
            text: alertText,
            metadata: {
              filters: {
                runId,
                source,
                sinceMinutes,
                bucketMinutes
              },
              anomaly,
              suppression,
              policy: {
                route_min_level: routeMinLevel,
                route_retry_max: deployTrendRoutingPolicy.routeRetryMax
              }
            },
            options: {
              toUserId: targetUserId,
              channel: targetChannel,
              retryMax: deployTrendRoutingPolicy.routeRetryMax
            }
          });

          const routeAttempted = !!routed;
          if (routeAttempted) {
            await saveDeployTrendRouteState({
              last_routed_at_ms: Date.now(),
              last_signature: suppression.current_signature || buildDeployTrendRouteSignature(anomaly),
              last_level: anomaly.level || 'info'
            });
          }
        }
      } else if (routeSuppressed) {
        routed = {
          attempted: false,
          routed: false,
          reason: 'suppressed',
          suppression
        };

        if (emitAudit && anomaly.anomaly_detected) {
          try {
            await db.logAgentAction(
              'deploy-trend',
              null,
              null,
              'deploy_trend_anomaly_route_suppressed',
              null,
              'success',
              null,
              {
                level: anomaly.level,
                reasons: anomaly.reasons,
                suppression,
                filters: {
                  runId,
                  source,
                  sinceMinutes,
                  bucketMinutes
                }
              }
            );
          } catch (_e) {
            // best effort only
          }
        }
      }

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
        route: {
          requested: !!route,
          min_level: routeMinLevel,
          should_route: !!shouldRoute,
          suppressed: !!routeSuppressed
        },
        suppression,
        anomaly,
        routed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/anomalies/suppression', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 15);
      const runLimit = Number(req.query.runLimit || 100);
      const timelineLimit = Number(req.query.timelineLimit || 2000);
      const heatmapLimit = Number(req.query.heatmapLimit || 500);

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

      if (!Number.isInteger(runLimit) || runLimit < 1 || runLimit > 500) {
        return badRequest(res, ['runLimit must be an integer between 1 and 500']);
      }

      if (!Number.isInteger(timelineLimit) || timelineLimit < 1 || timelineLimit > 10000) {
        return badRequest(res, ['timelineLimit must be an integer between 1 and 10000']);
      }

      if (!Number.isInteger(heatmapLimit) || heatmapLimit < 1 || heatmapLimit > 2000) {
        return badRequest(res, ['heatmapLimit must be an integer between 1 and 2000']);
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

      const anomaly = deployTrendAnomalyDetector.evaluate({ runs, timeline, heatmapRows });
      const suppression = await evaluateDeployTrendSuppression(anomaly);

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
        suppression,
        anomaly: {
          level: anomaly.level,
          anomaly_detected: anomaly.anomaly_detected,
          anomaly_count: anomaly.anomaly_count,
          reasons: anomaly.reasons
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/jobs/deploy-events/dashboard', async (req, res) => {
    try {
      const runId = req.query.runId ? String(req.query.runId).trim() : null;
      const source = req.query.source ? String(req.query.source).trim() : null;
      const sinceMinutes = Number(req.query.sinceMinutes || 240);
      const bucketMinutes = Number(req.query.bucketMinutes || 30);
      const runLimit = Number(req.query.runLimit || 20);
      const timelineLimit = Number(req.query.timelineLimit || 1000);
      const heatmapLimit = Number(req.query.heatmapLimit || 500);
      const includeTelemetry = req.query.includeTelemetry === undefined
        ? true
        : String(req.query.includeTelemetry).toLowerCase() !== 'false';
      const includeTelemetryTrend = req.query.includeTelemetryTrend === undefined
        ? false
        : String(req.query.includeTelemetryTrend).toLowerCase() !== 'false';

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

      if (!Number.isInteger(runLimit) || runLimit < 1 || runLimit > 500) {
        return badRequest(res, ['runLimit must be an integer between 1 and 500']);
      }

      if (!Number.isInteger(timelineLimit) || timelineLimit < 1 || timelineLimit > 10000) {
        return badRequest(res, ['timelineLimit must be an integer between 1 and 10000']);
      }

      if (!Number.isInteger(heatmapLimit) || heatmapLimit < 1 || heatmapLimit > 2000) {
        return badRequest(res, ['heatmapLimit must be an integer between 1 and 2000']);
      }

      const [timeline, heatmapRows, summary, anomalyTelemetry, anomalyTelemetryTrend] = await Promise.all([
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
        }),
        db.summarizeDeployRunEvents({
          sinceMinutes,
          runId
        }),
        includeTelemetry
          ? db.getDeployTrendAnomalyTelemetry({
            sinceMinutes,
            runId,
            source,
            limit: 5000
          })
          : Promise.resolve(null),
        includeTelemetryTrend
          ? db.getDeployTrendAnomalyTelemetryTrend({
            sinceMinutes,
            bucketMinutes,
            runId,
            source,
            limit: 5000,
            bucketLimit: 500
          })
          : Promise.resolve(null)
      ]);

      const heatmapTotals = heatmapRows.reduce((acc, row) => {
        acc.total += Number(row.total_count || 0);
        acc.error += Number(row.error_count || 0);
        acc.warn += Number(row.warn_count || 0);
        return acc;
      }, { total: 0, error: 0, warn: 0 });

      res.json({
        ok: true,
        filters: {
          runId,
          source,
          sinceMinutes,
          bucketMinutes,
          runLimit,
          timelineLimit,
          heatmapLimit,
          includeTelemetry,
          includeTelemetryTrend
        },
        timeline,
        heatmap: {
          rows: heatmapRows,
          totals: heatmapTotals,
          peak_event: heatmapRows[0]?.event || null
        },
        anomaly_telemetry: anomalyTelemetry,
        anomaly_telemetry_trend: anomalyTelemetryTrend,
        summary
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
        ? canaryDriftRoutingPolicy.routeEnabled
        : String(req.query.route).toLowerCase() !== 'false';

      const emitAudit = req.query.emitAudit === undefined
        ? true
        : String(req.query.emitAudit).toLowerCase() !== 'false';

      const suppressionEnabled = req.query.suppress === undefined
        ? canaryDriftRoutingPolicy.suppressionEnabled
        : String(req.query.suppress).toLowerCase() !== 'false';

      const routeMinLevel = canaryDriftRoutingPolicy.routeMinLevel;
      const levelRank = canaryDriftLevelRank;

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
      const routeCandidate = routeEnabled
        && drift.should_notify
        && (levelRank[drift.level] || 1) >= (levelRank[routeMinLevel] || 2);

      let suppression = {
        enabled: false,
        suppressed: false,
        reason: null,
        signature: null,
        remaining_ms: 0,
        state: { ...canaryDriftRouteStateMemory }
      };

      if (routeCandidate) {
        if (suppressionEnabled) {
          suppression = await evaluateCanaryDriftSuppression(drift);
        } else {
          suppression = {
            enabled: false,
            suppressed: false,
            reason: null,
            signature: buildCanaryDriftSignature(drift),
            remaining_ms: 0,
            state: await loadCanaryDriftRouteState()
          };
        }
      }

      const shouldRoute = routeCandidate && !suppression.suppressed;

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

        if (routed?.routed) {
          await saveCanaryDriftRouteState({
            last_routed_at_ms: Date.now(),
            last_signature: suppression.signature || buildCanaryDriftSignature(drift),
            last_level: String(drift.level || 'info').toLowerCase()
          });
        }
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
              route_candidate: routeCandidate,
              suppression,
              routed
            }
          );

          if (routeCandidate && suppression.suppressed) {
            await db.logAgentAction(
              'canary-monitor',
              null,
              null,
              'canary_profile_drift_route_suppressed',
              null,
              'success',
              null,
              {
                drift,
                suppression,
                route_enabled: routeEnabled,
                route_min_level: routeMinLevel
              }
            );
          }
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
          candidate: !!routeCandidate,
          attempted: !!shouldRoute,
          suppression
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
