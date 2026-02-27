const Redis = require('ioredis');
const { Pool } = require('pg');
const { normalizeAuditEvent } = require('../audit-log');

function extractDeployTrendTelemetryFilters(row) {
  return row?.metadata?.filters
    || row?.metadata?.metadata?.filters
    || {};
}

function matchesDeployTrendTelemetryScope(row, { runId = null, source = null } = {}) {
  const filters = extractDeployTrendTelemetryFilters(row);

  if (runId && String(filters?.runId || '') !== String(runId)) {
    return false;
  }

  if (source && String(filters?.source || '') !== String(source)) {
    return false;
  }

  return true;
}

function extractDeployTrendTelemetrySuppressionReason(row) {
  return row?.metadata?.suppression?.reason
    || row?.metadata?.route?.suppression?.reason
    || row?.metadata?.metadata?.suppression?.reason
    || row?.metadata?.metadata?.route?.suppression?.reason
    || null;
}

/**
 * Local Database Storage Manager
 * 使用本地 Redis + PostgreSQL
 */
class DatabaseStorageManager {
  constructor() {
    // Redis 連接 (STM)
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: 0,
      retryDelayOnFailover: 100
    });

    // PostgreSQL 連接池 (MTM)
    this.postgres = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://tj@localhost:5432/life_coach',
      max: 20, // 最大連接數
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });

    // 監聽連接錯誤
    this.postgres.on('error', (err) => {
      console.error('PostgreSQL connection error:', err);
    });

    this.outboxReadyPromise = null;
    this.deployEventsReadyPromise = null;

    // Query performance tracking
    this.queryStats = {
      total: 0,
      errors: 0,
      totalDuration: 0,
      slowQueries: [], // Queries > 1000ms
      queryTypes: {} // Group by query type
    };

    // Cache hit/miss tracking
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      keyPatterns: {} // Track by key pattern
    };

    // Wrap query method for performance tracking
    this.originalQuery = this.postgres.query.bind(this.postgres);
    this.postgres.query = this.trackedQuery.bind(this);

    console.log('✅ DatabaseStorageManager initialized');
  }

  // Query performance wrapper
  async trackedQuery(text, params) {
    const start = Date.now();
    const queryType = this.extractQueryType(text);

    try {
      const result = await this.originalQuery(text, params);
      const duration = Date.now() - start;

      // Update stats
      this.queryStats.total++;
      this.queryStats.totalDuration += duration;

      if (!this.queryStats.queryTypes[queryType]) {
        this.queryStats.queryTypes[queryType] = { count: 0, totalMs: 0, errors: 0 };
      }
      this.queryStats.queryTypes[queryType].count++;
      this.queryStats.queryTypes[queryType].totalMs += duration;

      // Track slow queries
      if (duration > 1000) {
        this.queryStats.slowQueries.push({
          type: queryType,
          duration,
          timestamp: new Date().toISOString(),
          preview: text.substring(0, 100)
        });
        // Keep only last 100 slow queries
        if (this.queryStats.slowQueries.length > 100) {
          this.queryStats.slowQueries.shift();
        }
      }

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.queryStats.total++;
      this.queryStats.errors++;
      this.queryStats.totalDuration += duration;

      if (!this.queryStats.queryTypes[queryType]) {
        this.queryStats.queryTypes[queryType] = { count: 0, totalMs: 0, errors: 0 };
      }
      this.queryStats.queryTypes[queryType].count++;
      this.queryStats.queryTypes[queryType].errors++;
      this.queryStats.queryTypes[queryType].totalMs += duration;

      throw error;
    }
  }

  extractQueryType(sql) {
    if (!sql) return 'unknown';
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith('SELECT')) return 'SELECT';
    if (upper.startsWith('INSERT')) return 'INSERT';
    if (upper.startsWith('UPDATE')) return 'UPDATE';
    if (upper.startsWith('DELETE')) return 'DELETE';
    if (upper.startsWith('CREATE')) return 'CREATE';
    if (upper.startsWith('ALTER')) return 'ALTER';
    return 'OTHER';
  }

  getQueryMetrics() {
    const avgDuration = this.queryStats.total > 0
      ? Math.round(this.queryStats.totalDuration / this.queryStats.total)
      : 0;

    const queryTypeStats = Object.entries(this.queryStats.queryTypes).map(([type, stats]) => ({
      type,
      count: stats.count,
      avg_ms: stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0,
      error_rate: stats.count > 0 ? ((stats.errors / stats.count) * 100).toFixed(2) + '%' : '0%'
    })).sort((a, b) => b.count - a.count);

    return {
      total_queries: this.queryStats.total,
      total_errors: this.queryStats.errors,
      error_rate: this.queryStats.total > 0
        ? ((this.queryStats.errors / this.queryStats.total) * 100).toFixed(2) + '%'
        : '0%',
      avg_duration_ms: avgDuration,
      slow_query_count: this.queryStats.slowQueries.length,
      recent_slow_queries: this.queryStats.slowQueries.slice(-5),
      query_types: queryTypeStats,
      generated_at: new Date().toISOString()
    };
  }

  // Cache tracking helpers
  recordCacheHit(key) {
    this.cacheStats.hits++;
    this.recordKeyPattern(key, 'hit');
  }

  recordCacheMiss(key) {
    this.cacheStats.misses++;
    this.recordKeyPattern(key, 'miss');
  }

  recordCacheSet(key) {
    this.cacheStats.sets++;
    this.recordKeyPattern(key, 'set');
  }

  recordCacheDelete(key) {
    this.cacheStats.deletes++;
    this.recordKeyPattern(key, 'delete');
  }

  recordCacheError(key) {
    this.cacheStats.errors++;
    this.recordKeyPattern(key, 'error');
  }

  recordKeyPattern(key, operation) {
    // Extract pattern (e.g., "session:*" -> "session")
    const pattern = key?.split(':')[0] || 'unknown';
    if (!this.cacheStats.keyPatterns[pattern]) {
      this.cacheStats.keyPatterns[pattern] = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 };
    }
    if (operation === 'hit') this.cacheStats.keyPatterns[pattern].hits++;
    if (operation === 'miss') this.cacheStats.keyPatterns[pattern].misses++;
    if (operation === 'set') this.cacheStats.keyPatterns[pattern].sets++;
    if (operation === 'delete') this.cacheStats.keyPatterns[pattern].deletes++;
    if (operation === 'error') this.cacheStats.keyPatterns[pattern].errors++;
  }

  getCacheMetrics() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      sets: this.cacheStats.sets,
      deletes: this.cacheStats.deletes,
      errors: this.cacheStats.errors,
      hit_rate: total > 0 ? ((this.cacheStats.hits / total) * 100).toFixed(2) + '%' : '0%',
      miss_rate: total > 0 ? ((this.cacheStats.misses / total) * 100).toFixed(2) + '%' : '0%',
      total_operations: this.cacheStats.hits + this.cacheStats.misses + this.cacheStats.sets + this.cacheStats.deletes,
      key_patterns: Object.entries(this.cacheStats.keyPatterns).map(([pattern, stats]) => ({
        pattern,
        hits: stats.hits,
        misses: stats.misses,
        hit_rate: (stats.hits + stats.misses) > 0
          ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%'
          : '0%'
      })).sort((a, b) => (b.hits + b.misses) - (a.hits + a.misses)),
      generated_at: new Date().toISOString()
    };
  }

  // ========== STM (Short Term Memory) - Redis ==========

  async getSession(sessionId) {
    try {
      const data = await this.redis.get(`session:${sessionId}`);
      if (data) {
        this.recordCacheHit(`session:${sessionId}`);
        return JSON.parse(data);
      }
      this.recordCacheMiss(`session:${sessionId}`);
      return null;
    } catch (err) {
      this.recordCacheError(`session:${sessionId}`);
      throw err;
    }
  }

  async setSession(sessionId, data, ttlSeconds = 86400) {
    try {
      await this.redis.setex(
        `session:${sessionId}`,
        ttlSeconds,
        JSON.stringify(data)
      );
      this.recordCacheSet(`session:${sessionId}`);
    } catch (err) {
      this.recordCacheError(`session:${sessionId}`);
      throw err;
    }
  }

  async deleteSession(sessionId) {
    try {
      await this.redis.del(`session:${sessionId}`);
      this.recordCacheDelete(`session:${sessionId}`);
    } catch (err) {
      this.recordCacheError(`session:${sessionId}`);
      throw err;
    }
  }

  async extendSessionTTL(sessionId, ttlSeconds = 86400) {
    try {
      await this.redis.expire(`session:${sessionId}`, ttlSeconds);
    } catch (err) {
      this.recordCacheError(`session:${sessionId}`);
      throw err;
    }
  }

  // ========== MTM (Medium Term Memory) - PostgreSQL ==========

  async getUserProfile(userId) {
    const result = await this.postgres.query(
      'SELECT profile_data FROM user_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.profile_data || null;
  }

  async createUserProfile(userId, profileData) {
    await this.postgres.query(
      `INSERT INTO user_profiles (user_id, profile_data, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET profile_data = $2, updated_at = NOW()`,
      [userId, JSON.stringify(profileData)]
    );
    return profileData;
  }

  async updateUserProfile(userId, updates) {
    const existing = await this.getUserProfile(userId) || {};
    const updated = { ...existing, ...updates };
    
    await this.postgres.query(
      `INSERT INTO user_profiles (user_id, profile_data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET profile_data = $2, updated_at = NOW()`,
      [userId, JSON.stringify(updated)]
    );
    return updated;
  }

  async getConversation(sessionId) {
    const result = await this.postgres.query(
      `SELECT c.*, 
              json_agg(m.* ORDER BY m.timestamp) as messages
       FROM conversations c
       LEFT JOIN messages m ON c.session_id = m.session_id
       WHERE c.session_id = $1
       GROUP BY c.session_id`,
      [sessionId]
    );
    return result.rows[0] || null;
  }

  async createConversation(sessionId, userId, metadata = {}) {
    await this.postgres.query(
      `INSERT INTO conversations (session_id, user_id, status, metadata, started_at)
       VALUES ($1, $2, 'active', $3, NOW())
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, userId, JSON.stringify(metadata)]
    );
    return { session_id: sessionId, user_id: userId, messages: [] };
  }

  async addMessage(sessionId, userId, role, content, agentId = null, importanceScore = null) {
    await this.postgres.query(
      `INSERT INTO messages (session_id, user_id, role, content, agent_id, importance_score, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [sessionId, userId, role, content, agentId, importanceScore]
    );
  }

  async getRecentMessages(userId, limit = 20) {
    const result = await this.postgres.query(
      `SELECT m.*, c.session_id
       FROM messages m
       JOIN conversations c ON m.session_id = c.session_id
       WHERE m.user_id = $1
       ORDER BY m.timestamp DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  async getBehaviorPatterns(userId, patternType = null) {
    let query = 'SELECT * FROM behavior_patterns WHERE user_id = $1';
    const params = [userId];
    
    if (patternType) {
      query += ' AND pattern_type = $2';
      params.push(patternType);
    }
    
    query += ' ORDER BY confidence_score DESC';
    
    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async saveBehaviorPattern(userId, patternType, patternData, confidenceScore = 0.5) {
    await this.postgres.query(
      `INSERT INTO behavior_patterns 
       (user_id, pattern_type, pattern_data, confidence_score, first_observed, last_observed, occurrence_count)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), 1)
       ON CONFLICT (user_id, pattern_type) 
       DO UPDATE SET 
         pattern_data = $3,
         confidence_score = behavior_patterns.confidence_score * 0.9 + $4 * 0.1,
         last_observed = NOW(),
         occurrence_count = behavior_patterns.occurrence_count + 1`,
      [userId, patternType, JSON.stringify(patternData), confidenceScore]
    );
  }

  async getGoals(userId, status = null) {
    let query = 'SELECT * FROM goals WHERE user_id = $1';
    const params = [userId];
    
    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async createGoal(userId, goalData) {
    const result = await this.postgres.query(
      `INSERT INTO goals (user_id, domain, title, description, status, progress, target_date, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING goal_id`,
      [
        userId,
        goalData.domain,
        goalData.title,
        goalData.description,
        goalData.status || 'active',
        goalData.progress || 0,
        goalData.target_date,
        JSON.stringify(goalData.metadata || {})
      ]
    );
    return result.rows[0].goal_id;
  }

  async updateGoalProgress(goalId, progress) {
    await this.postgres.query(
      `UPDATE goals 
       SET progress = $2, 
           status = CASE WHEN $2 >= 1 THEN 'completed' ELSE status END,
           completed_at = CASE WHEN $2 >= 1 THEN NOW() ELSE completed_at END
       WHERE goal_id = $1`,
      [goalId, progress]
    );
  }

  async recordKBIMetric(userId, metricName, metricValue) {
    await this.postgres.query(
      `INSERT INTO kbi_metrics (user_id, metric_name, metric_value, recorded_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, metricName, metricValue]
    );
  }

  async getKBIMetrics(userId, metricName, period = 'daily', limit = 30) {
    const result = await this.postgres.query(
      `SELECT * FROM kbi_metrics 
       WHERE user_id = $1 AND metric_name = $2 AND period = $3
       ORDER BY recorded_at DESC
       LIMIT $4`,
      [userId, metricName, period, limit]
    );
    return result.rows;
  }

  async getUserPreferences(userId) {
    const result = await this.postgres.query(
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    return result.rows;
  }

  async setUserPreference(userId, category, preferenceValue, source = 'inferred') {
    await this.postgres.query(
      `INSERT INTO user_preferences (user_id, category, preference_value, source, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, category) 
       DO UPDATE SET preference_value = $3, source = $4, updated_at = NOW()`,
      [userId, category, JSON.stringify(preferenceValue), source]
    );
  }

  // ========== LTM (Long Term Memory) - PostgreSQL + File Hybrid ==========
  // 重要人生事件存 PostgreSQL，大文件存本地

  async addMilestone(userId, milestoneData) {
    const result = await this.postgres.query(
      `INSERT INTO milestones (user_id, milestone_type, title, description, date, impact_score, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING milestone_id`,
      [
        userId,
        milestoneData.type,
        milestoneData.title,
        milestoneData.description,
        milestoneData.date,
        milestoneData.impact_score || 0.5,
        JSON.stringify(milestoneData.metadata || {})
      ]
    );
    return result.rows[0].milestone_id;
  }

  async getMilestones(userId) {
    const result = await this.postgres.query(
      `SELECT * FROM milestones 
       WHERE user_id = $1 
       ORDER BY date DESC`,
      [userId]
    );
    return result.rows;
  }

  // ========== Agent Logs ==========

  async logAgentAction(agentId, userId, sessionId, action, durationMs, status, errorMessage = null, metadata = {}) {
    const normalized = normalizeAuditEvent({
      agentId,
      userId,
      sessionId,
      action,
      durationMs,
      status,
      errorMessage,
      metadata
    });

    await this.postgres.query(
      `INSERT INTO agent_logs (agent_id, user_id, session_id, action, duration_ms, status, error_message, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        normalized.agentId,
        normalized.userId,
        normalized.sessionId,
        normalized.action,
        normalized.durationMs,
        normalized.status,
        normalized.errorMessage,
        JSON.stringify(normalized.metadata)
      ]
    );
  }

  async getAgentLogs(agentId, limit = 100) {
    const result = await this.postgres.query(
      `SELECT * FROM agent_logs 
       WHERE agent_id = $1 
       ORDER BY timestamp DESC 
       LIMIT $2`,
      [agentId, limit]
    );
    return result.rows;
  }

  // ========== Outbound Delivery Pipeline ==========

  async ensureOutboxTable() {
    if (!this.outboxReadyPromise) {
      this.outboxReadyPromise = (async () => {
        await this.postgres.query(
          `CREATE TABLE IF NOT EXISTS outbound_events (
             event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
             created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
             dispatched_at TIMESTAMP WITH TIME ZONE,
             source VARCHAR(50) NOT NULL,
             channel VARCHAR(50) NOT NULL DEFAULT 'cron-event',
             event_type VARCHAR(80) NOT NULL,
             user_id UUID REFERENCES user_profiles(user_id) ON DELETE CASCADE,
             status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'dispatched', 'failed', 'dead_letter')),
             payload JSONB DEFAULT '{}',
             delivery_metadata JSONB DEFAULT '{}',
             error_message TEXT,
             retry_count INT NOT NULL DEFAULT 0,
             max_retries INT NOT NULL DEFAULT 5,
             next_retry_at TIMESTAMP WITH TIME ZONE
           )`
        );

        // Migrate existing tables: add retry columns if missing (must run before retry index)
        const cols = await this.postgres.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'outbound_events' AND column_name = 'retry_count'`
        );
        if (cols.rows.length === 0) {
          await this.postgres.query(`ALTER TABLE outbound_events ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0`);
          await this.postgres.query(`ALTER TABLE outbound_events ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 5`);
          await this.postgres.query(`ALTER TABLE outbound_events ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE`);
          // Relax status check to include dead_letter
          await this.postgres.query(`ALTER TABLE outbound_events DROP CONSTRAINT IF EXISTS outbound_events_status_check`);
          await this.postgres.query(`ALTER TABLE outbound_events ADD CONSTRAINT outbound_events_status_check CHECK (status IN ('pending', 'dispatched', 'failed', 'dead_letter'))`);
        }

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_outbound_events_status_created
             ON outbound_events(status, created_at DESC)`
        );

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_outbound_events_user
             ON outbound_events(user_id)`
        );

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_outbound_events_retry
             ON outbound_events(status, next_retry_at ASC)
             WHERE status = 'failed'`
        );
      })().catch((err) => {
        this.outboxReadyPromise = null;
        throw err;
      });
    }

    return this.outboxReadyPromise;
  }

  async enqueueOutboundEvent({
    eventType,
    userId = null,
    channel = 'cron-event',
    source = 'scheduler',
    payload = {}
  }) {
    await this.ensureOutboxTable();

    const result = await this.postgres.query(
      `INSERT INTO outbound_events (event_type, user_id, channel, source, payload, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
       RETURNING event_id`,
      [eventType, userId, channel, source, JSON.stringify(payload)]
    );

    return result.rows[0].event_id;
  }

  async listOutboundEvents({ status = 'pending', limit = 50, eventType = null } = {}) {
    await this.ensureOutboxTable();

    let query = `SELECT * FROM outbound_events WHERE status = $1`;
    const params = [status];

    if (eventType) {
      query += ` AND event_type = $2`;
      params.push(eventType);
    }

    query += ` ORDER BY created_at ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async getOutboundEventById(eventId) {
    await this.ensureOutboxTable();

    const result = await this.postgres.query(
      `SELECT * FROM outbound_events WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );

    return result.rows[0] || null;
  }

  async markOutboundEventDispatched(eventId, metadata = {}) {
    await this.ensureOutboxTable();

    await this.postgres.query(
      `UPDATE outbound_events
       SET status = 'dispatched',
           dispatched_at = NOW(),
           delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb) || $2::jsonb,
           error_message = NULL,
           next_retry_at = NULL
       WHERE event_id = $1`,
      [eventId, JSON.stringify(metadata || {})]
    );
  }

  async markOutboundEventFailed(eventId, errorMessage = null, metadata = {}) {
    await this.ensureOutboxTable();

    await this.postgres.query(
      `UPDATE outbound_events
       SET status = 'failed',
           error_message = $2,
           delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb) || $3::jsonb
       WHERE event_id = $1`,
      [eventId, errorMessage, JSON.stringify(metadata || {})]
    );
  }

  /**
   * Get failed events eligible for retry (retry_count < max_retries AND next_retry_at <= NOW or null).
   */
  async getRetryableEvents({ limit = 50 } = {}) {
    await this.ensureOutboxTable();

    const result = await this.postgres.query(
      `SELECT * FROM outbound_events
       WHERE status = 'failed'
         AND retry_count < max_retries
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  /**
   * Increment retry_count and set next_retry_at for a failed event.
   */
  async incrementRetryCount(eventId, nextRetryAt = null) {
    await this.ensureOutboxTable();

    await this.postgres.query(
      `UPDATE outbound_events
       SET retry_count = retry_count + 1,
           next_retry_at = $2
       WHERE event_id = $1`,
      [eventId, nextRetryAt]
    );
  }

  /**
   * Move an event to dead_letter status (retries exhausted).
   */
  async markOutboundEventDeadLetter(eventId, errorMessage = null, metadata = {}) {
    await this.ensureOutboxTable();

    await this.postgres.query(
      `UPDATE outbound_events
       SET status = 'dead_letter',
           error_message = $2,
           delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb) || $3::jsonb,
           next_retry_at = NULL
       WHERE event_id = $1`,
      [eventId, errorMessage, JSON.stringify(metadata || {})]
    );
  }

  /**
   * List dead-letter events for inspection/manual replay.
   */
  async getDeadLetterEvents({ limit = 50, eventType = null, userId = null, olderThanMinutes = null } = {}) {
    await this.ensureOutboxTable();

    let query = `SELECT * FROM outbound_events WHERE status = 'dead_letter'`;
    const params = [];

    if (eventType) {
      params.push(eventType);
      query += ` AND event_type = $${params.length}`;
    }

    if (userId) {
      params.push(userId);
      query += ` AND user_id = $${params.length}`;
    }

    if (Number.isInteger(olderThanMinutes) && olderThanMinutes > 0) {
      params.push(olderThanMinutes);
      query += ` AND created_at <= NOW() - ($${params.length} * INTERVAL '1 minute')`;
    }

    params.push(limit);
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async getOutboundEventStats(windowMinutes = 60) {
    await this.ensureOutboxTable();

    const [totalRows, recentRows] = await Promise.all([
      this.postgres.query(
        `SELECT status, COUNT(*)::int AS count
         FROM outbound_events
         GROUP BY status`
      ),
      this.postgres.query(
        `SELECT status, COUNT(*)::int AS count
         FROM outbound_events
         WHERE created_at >= NOW() - ($1 * INTERVAL '1 minute')
         GROUP BY status`,
        [windowMinutes]
      )
    ]);

    const byStatus = { pending: 0, dispatched: 0, failed: 0, dead_letter: 0 };
    const recentByStatus = { pending: 0, dispatched: 0, failed: 0, dead_letter: 0 };

    for (const row of totalRows.rows) {
      byStatus[row.status] = Number(row.count);
    }

    for (const row of recentRows.rows) {
      recentByStatus[row.status] = Number(row.count);
    }

    const recentTotal = recentByStatus.pending + recentByStatus.dispatched + recentByStatus.failed;

    return {
      total: byStatus,
      recent: {
        window_minutes: windowMinutes,
        ...recentByStatus,
        total: recentTotal,
        failure_rate: recentTotal > 0
          ? Number((recentByStatus.failed / recentTotal).toFixed(4))
          : 0
      }
    };
  }

  async getSchedulerDeliveryMetrics({ windowMinutes = 60, limit = 500 } = {}) {
    const result = await this.postgres.query(
      `SELECT action, status, timestamp, metadata
       FROM agent_logs
       WHERE action IN ('scheduled_monitor_cycle', 'scheduled_morning_checkin')
         AND timestamp >= NOW() - ($1 * INTERVAL '1 minute')
       ORDER BY timestamp DESC
       LIMIT $2`,
      [windowMinutes, limit]
    );

    const metrics = {
      window_minutes: windowMinutes,
      sample_size: result.rows.length,
      monitor_cycles: 0,
      morning_cycles: 0,
      attempted_deliveries: 0,
      delivered: 0,
      failed: 0,
      skipped: 0,
      last_delivery_at: null,
      last_failure_at: null,
      failure_rate: 0
    };

    for (const row of result.rows) {
      if (row.action === 'scheduled_monitor_cycle') metrics.monitor_cycles += 1;
      if (row.action === 'scheduled_morning_checkin') metrics.morning_cycles += 1;

      const delivery = row.metadata?.delivery;
      const mode = delivery?.mode || null;

      if (!delivery) {
        metrics.skipped += 1;
        continue;
      }

      if (mode === 'none' || delivery.reason === 'delivery disabled') {
        metrics.skipped += 1;
        continue;
      }

      metrics.attempted_deliveries += 1;

      if (delivery.delivered) {
        metrics.delivered += 1;
        if (!metrics.last_delivery_at || row.timestamp > metrics.last_delivery_at) {
          metrics.last_delivery_at = row.timestamp;
        }
      } else {
        metrics.failed += 1;
        if (!metrics.last_failure_at || row.timestamp > metrics.last_failure_at) {
          metrics.last_failure_at = row.timestamp;
        }
      }
    }

    if (metrics.attempted_deliveries > 0) {
      metrics.failure_rate = Number((metrics.failed / metrics.attempted_deliveries).toFixed(4));
    }

    return metrics;
  }

  async getDeployTrendAnomalyTelemetry({
    sinceMinutes = 240,
    runId = null,
    source = null,
    limit = 5000
  } = {}) {
    const result = await this.postgres.query(
      `SELECT agent_id, action, status, metadata, timestamp
       FROM agent_logs
       WHERE action IN ('deploy_trend_anomaly_detected', 'deploy_trend_anomaly_route_suppressed', 'deploy_trend_anomaly_routed')
         AND timestamp >= NOW() - ($1 * INTERVAL '1 minute')
       ORDER BY timestamp DESC
       LIMIT $2`,
      [sinceMinutes, limit]
    );

    const metrics = {
      window_minutes: sinceMinutes,
      sample_size: 0,
      detected: 0,
      suppressed: 0,
      route_attempted: 0,
      route_delivered: 0,
      route_failed: 0,
      last_detected_at: null,
      last_suppressed_at: null,
      last_route_attempt_at: null,
      filters: {
        run_id: runId || null,
        source: source || null
      }
    };

    for (const row of result.rows) {
      if (!matchesDeployTrendTelemetryScope(row, { runId, source })) continue;

      metrics.sample_size += 1;

      if (row.action === 'deploy_trend_anomaly_detected') {
        metrics.detected += 1;
        if (!metrics.last_detected_at || row.timestamp > metrics.last_detected_at) {
          metrics.last_detected_at = row.timestamp;
        }
      }

      if (row.action === 'deploy_trend_anomaly_route_suppressed') {
        metrics.suppressed += 1;
        if (!metrics.last_suppressed_at || row.timestamp > metrics.last_suppressed_at) {
          metrics.last_suppressed_at = row.timestamp;
        }
      }

      if (row.action === 'deploy_trend_anomaly_routed') {
        metrics.route_attempted += 1;
        if (!metrics.last_route_attempt_at || row.timestamp > metrics.last_route_attempt_at) {
          metrics.last_route_attempt_at = row.timestamp;
        }

        if (String(row.status || '').toLowerCase() === 'success') {
          metrics.route_delivered += 1;
        } else {
          metrics.route_failed += 1;
        }
      }
    }

    metrics.suppression_rate = metrics.detected > 0
      ? Number((metrics.suppressed / metrics.detected).toFixed(4))
      : 0;

    metrics.route_attempt_rate = metrics.detected > 0
      ? Number((metrics.route_attempted / metrics.detected).toFixed(4))
      : 0;

    return metrics;
  }

  async getDeployTrendAnomalyTelemetryTrend({
    sinceMinutes = 240,
    bucketMinutes = 60,
    runId = null,
    source = null,
    limit = 5000,
    bucketLimit = 500
  } = {}) {
    const result = await this.postgres.query(
      `SELECT action, status, metadata, timestamp
       FROM agent_logs
       WHERE action IN ('deploy_trend_anomaly_detected', 'deploy_trend_anomaly_route_suppressed', 'deploy_trend_anomaly_routed')
         AND timestamp >= NOW() - ($1 * INTERVAL '1 minute')
       ORDER BY timestamp DESC
       LIMIT $2`,
      [sinceMinutes, limit]
    );

    const bucketMs = Math.max(1, Number(bucketMinutes)) * 60 * 1000;
    const bucketMap = new Map();

    let sampleSize = 0;

    for (const row of result.rows) {
      if (!matchesDeployTrendTelemetryScope(row, { runId, source })) continue;

      sampleSize += 1;

      const tsMs = new Date(row.timestamp).getTime();
      if (!Number.isFinite(tsMs)) continue;

      const bucketStartMs = Math.floor(tsMs / bucketMs) * bucketMs;
      const bucketKey = String(bucketStartMs);

      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          bucket_start: new Date(bucketStartMs).toISOString(),
          bucket_end: new Date(bucketStartMs + bucketMs).toISOString(),
          detected: 0,
          suppressed: 0,
          route_attempted: 0,
          route_delivered: 0,
          route_failed: 0
        });
      }

      const bucket = bucketMap.get(bucketKey);

      if (row.action === 'deploy_trend_anomaly_detected') {
        bucket.detected += 1;
      }

      if (row.action === 'deploy_trend_anomaly_route_suppressed') {
        bucket.suppressed += 1;
      }

      if (row.action === 'deploy_trend_anomaly_routed') {
        bucket.route_attempted += 1;
        if (String(row.status || '').toLowerCase() === 'success') {
          bucket.route_delivered += 1;
        } else {
          bucket.route_failed += 1;
        }
      }
    }

    const buckets = Array.from(bucketMap.values())
      .sort((a, b) => new Date(a.bucket_start) - new Date(b.bucket_start))
      .slice(-bucketLimit)
      .map((bucket) => ({
        ...bucket,
        suppression_rate: bucket.detected > 0
          ? Number((bucket.suppressed / bucket.detected).toFixed(4))
          : 0,
        route_attempt_rate: bucket.detected > 0
          ? Number((bucket.route_attempted / bucket.detected).toFixed(4))
          : 0,
        route_success_rate: bucket.route_attempted > 0
          ? Number((bucket.route_delivered / bucket.route_attempted).toFixed(4))
          : 0
      }));

    return {
      window_minutes: sinceMinutes,
      bucket_minutes: bucketMinutes,
      sample_size: sampleSize,
      bucket_count: buckets.length,
      filters: {
        run_id: runId || null,
        source: source || null
      },
      buckets
    };
  }

  async getDeployTrendTelemetryAlertSuppressionTrend({
    sinceMinutes = 240,
    bucketMinutes = 60,
    runId = null,
    source = null,
    limit = 5000,
    bucketLimit = 500
  } = {}) {
    const result = await this.postgres.query(
      `SELECT action, status, metadata, timestamp
       FROM agent_logs
       WHERE action IN (
         'deploy_trend_telemetry_alert_detected',
         'deploy_trend_telemetry_alert_route_suppressed',
         'deploy_trend_telemetry_alert_routed'
       )
         AND timestamp >= NOW() - ($1 * INTERVAL '1 minute')
       ORDER BY timestamp DESC
       LIMIT $2`,
      [sinceMinutes, limit]
    );

    const bucketMs = Math.max(1, Number(bucketMinutes)) * 60 * 1000;
    const bucketMap = new Map();

    let sampleSize = 0;

    for (const row of result.rows) {
      if (!matchesDeployTrendTelemetryScope(row, { runId, source })) continue;

      sampleSize += 1;

      const tsMs = new Date(row.timestamp).getTime();
      if (!Number.isFinite(tsMs)) continue;

      const bucketStartMs = Math.floor(tsMs / bucketMs) * bucketMs;
      const bucketKey = String(bucketStartMs);

      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          bucket_start: new Date(bucketStartMs).toISOString(),
          bucket_end: new Date(bucketStartMs + bucketMs).toISOString(),
          detected: 0,
          route_candidate: 0,
          route_attempted: 0,
          route_suppressed_total: 0,
          route_suppressed_cooldown: 0,
          route_suppressed_duplicate_window: 0,
          route_suppressed_other: 0,
          route_delivered: 0,
          route_failed: 0
        });
      }

      const bucket = bucketMap.get(bucketKey);

      if (row.action === 'deploy_trend_telemetry_alert_detected') {
        bucket.detected += 1;
        if (row.metadata?.route?.candidate) {
          bucket.route_candidate += 1;
        }
      }

      if (row.action === 'deploy_trend_telemetry_alert_route_suppressed') {
        bucket.route_suppressed_total += 1;
        const reason = String(extractDeployTrendTelemetrySuppressionReason(row) || '').toLowerCase();

        if (reason === 'cooldown') {
          bucket.route_suppressed_cooldown += 1;
        } else if (reason === 'duplicate_window') {
          bucket.route_suppressed_duplicate_window += 1;
        } else {
          bucket.route_suppressed_other += 1;
        }
      }

      if (row.action === 'deploy_trend_telemetry_alert_routed') {
        bucket.route_attempted += 1;
        if (String(row.status || '').toLowerCase() === 'success') {
          bucket.route_delivered += 1;
        } else {
          bucket.route_failed += 1;
        }
      }
    }

    const buckets = Array.from(bucketMap.values())
      .sort((a, b) => new Date(a.bucket_start) - new Date(b.bucket_start))
      .slice(-bucketLimit)
      .map((bucket) => ({
        ...bucket,
        route_attempt_rate: bucket.route_candidate > 0
          ? Number((bucket.route_attempted / bucket.route_candidate).toFixed(4))
          : 0,
        suppression_rate: (bucket.route_candidate > 0 || bucket.detected > 0)
          ? Number((bucket.route_suppressed_total / Math.max(1, bucket.route_candidate || bucket.detected)).toFixed(4))
          : 0,
        route_failure_rate: bucket.route_attempted > 0
          ? Number((bucket.route_failed / bucket.route_attempted).toFixed(4))
          : 0,
        cooldown_share: bucket.route_suppressed_total > 0
          ? Number((bucket.route_suppressed_cooldown / bucket.route_suppressed_total).toFixed(4))
          : 0,
        duplicate_window_share: bucket.route_suppressed_total > 0
          ? Number((bucket.route_suppressed_duplicate_window / bucket.route_suppressed_total).toFixed(4))
          : 0
      }));

    const totals = buckets.reduce((acc, bucket) => {
      acc.detected += Number(bucket.detected || 0);
      acc.route_candidate += Number(bucket.route_candidate || 0);
      acc.route_attempted += Number(bucket.route_attempted || 0);
      acc.route_suppressed_total += Number(bucket.route_suppressed_total || 0);
      acc.route_suppressed_cooldown += Number(bucket.route_suppressed_cooldown || 0);
      acc.route_suppressed_duplicate_window += Number(bucket.route_suppressed_duplicate_window || 0);
      acc.route_suppressed_other += Number(bucket.route_suppressed_other || 0);
      acc.route_delivered += Number(bucket.route_delivered || 0);
      acc.route_failed += Number(bucket.route_failed || 0);
      return acc;
    }, {
      detected: 0,
      route_candidate: 0,
      route_attempted: 0,
      route_suppressed_total: 0,
      route_suppressed_cooldown: 0,
      route_suppressed_duplicate_window: 0,
      route_suppressed_other: 0,
      route_delivered: 0,
      route_failed: 0
    });

    totals.route_attempt_rate = totals.route_candidate > 0
      ? Number((totals.route_attempted / totals.route_candidate).toFixed(4))
      : 0;

    totals.suppression_rate = (totals.route_candidate > 0 || totals.detected > 0)
      ? Number((totals.route_suppressed_total / Math.max(1, totals.route_candidate || totals.detected)).toFixed(4))
      : 0;

    totals.route_failure_rate = totals.route_attempted > 0
      ? Number((totals.route_failed / totals.route_attempted).toFixed(4))
      : 0;

    totals.cooldown_share = totals.route_suppressed_total > 0
      ? Number((totals.route_suppressed_cooldown / totals.route_suppressed_total).toFixed(4))
      : 0;

    totals.duplicate_window_share = totals.route_suppressed_total > 0
      ? Number((totals.route_suppressed_duplicate_window / totals.route_suppressed_total).toFixed(4))
      : 0;

    return {
      window_minutes: sinceMinutes,
      bucket_minutes: bucketMinutes,
      sample_size: sampleSize,
      bucket_count: buckets.length,
      filters: {
        run_id: runId || null,
        source: source || null
      },
      totals,
      buckets
    };
  }

  async getDeployTrendTelemetrySuppressionAlertRouteSuppressionTrend({
    sinceMinutes = 240,
    bucketMinutes = 60,
    runId = null,
    source = null,
    limit = 5000,
    bucketLimit = 500
  } = {}) {
    const result = await this.postgres.query(
      `SELECT action, status, metadata, timestamp
       FROM agent_logs
       WHERE action IN (
         'deploy_trend_telemetry_suppression_alert_detected',
         'deploy_trend_telemetry_suppression_alert_route_suppressed',
         'deploy_trend_telemetry_suppression_alert_routed'
       )
         AND timestamp >= NOW() - ($1 * INTERVAL '1 minute')
       ORDER BY timestamp DESC
       LIMIT $2`,
      [sinceMinutes, limit]
    );

    const bucketMs = Math.max(1, Number(bucketMinutes)) * 60 * 1000;
    const bucketMap = new Map();

    let sampleSize = 0;

    for (const row of result.rows) {
      if (!matchesDeployTrendTelemetryScope(row, { runId, source })) continue;

      sampleSize += 1;

      const tsMs = new Date(row.timestamp).getTime();
      if (!Number.isFinite(tsMs)) continue;

      const bucketStartMs = Math.floor(tsMs / bucketMs) * bucketMs;
      const bucketKey = String(bucketStartMs);

      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          bucket_start: new Date(bucketStartMs).toISOString(),
          bucket_end: new Date(bucketStartMs + bucketMs).toISOString(),
          detected: 0,
          route_candidate: 0,
          route_attempted: 0,
          route_suppressed_total: 0,
          route_suppressed_cooldown: 0,
          route_suppressed_duplicate_window: 0,
          route_suppressed_other: 0,
          route_delivered: 0,
          route_failed: 0
        });
      }

      const bucket = bucketMap.get(bucketKey);

      if (row.action === 'deploy_trend_telemetry_suppression_alert_detected') {
        bucket.detected += 1;
        if (row.metadata?.route?.candidate) {
          bucket.route_candidate += 1;
        }
      }

      if (row.action === 'deploy_trend_telemetry_suppression_alert_route_suppressed') {
        bucket.route_suppressed_total += 1;
        const reason = String(extractDeployTrendTelemetrySuppressionReason(row) || '').toLowerCase();

        if (reason === 'cooldown') {
          bucket.route_suppressed_cooldown += 1;
        } else if (reason === 'duplicate_window') {
          bucket.route_suppressed_duplicate_window += 1;
        } else {
          bucket.route_suppressed_other += 1;
        }
      }

      if (row.action === 'deploy_trend_telemetry_suppression_alert_routed') {
        bucket.route_attempted += 1;
        if (String(row.status || '').toLowerCase() === 'success') {
          bucket.route_delivered += 1;
        } else {
          bucket.route_failed += 1;
        }
      }
    }

    const buckets = Array.from(bucketMap.values())
      .sort((a, b) => new Date(a.bucket_start) - new Date(b.bucket_start))
      .slice(-bucketLimit)
      .map((bucket) => ({
        ...bucket,
        route_attempt_rate: bucket.route_candidate > 0
          ? Number((bucket.route_attempted / bucket.route_candidate).toFixed(4))
          : 0,
        suppression_rate: (bucket.route_candidate > 0 || bucket.detected > 0)
          ? Number((bucket.route_suppressed_total / Math.max(1, bucket.route_candidate || bucket.detected)).toFixed(4))
          : 0,
        route_failure_rate: bucket.route_attempted > 0
          ? Number((bucket.route_failed / bucket.route_attempted).toFixed(4))
          : 0,
        cooldown_share: bucket.route_suppressed_total > 0
          ? Number((bucket.route_suppressed_cooldown / bucket.route_suppressed_total).toFixed(4))
          : 0,
        duplicate_window_share: bucket.route_suppressed_total > 0
          ? Number((bucket.route_suppressed_duplicate_window / bucket.route_suppressed_total).toFixed(4))
          : 0
      }));

    const totals = buckets.reduce((acc, bucket) => {
      acc.detected += Number(bucket.detected || 0);
      acc.route_candidate += Number(bucket.route_candidate || 0);
      acc.route_attempted += Number(bucket.route_attempted || 0);
      acc.route_suppressed_total += Number(bucket.route_suppressed_total || 0);
      acc.route_suppressed_cooldown += Number(bucket.route_suppressed_cooldown || 0);
      acc.route_suppressed_duplicate_window += Number(bucket.route_suppressed_duplicate_window || 0);
      acc.route_suppressed_other += Number(bucket.route_suppressed_other || 0);
      acc.route_delivered += Number(bucket.route_delivered || 0);
      acc.route_failed += Number(bucket.route_failed || 0);
      return acc;
    }, {
      detected: 0,
      route_candidate: 0,
      route_attempted: 0,
      route_suppressed_total: 0,
      route_suppressed_cooldown: 0,
      route_suppressed_duplicate_window: 0,
      route_suppressed_other: 0,
      route_delivered: 0,
      route_failed: 0
    });

    totals.route_attempt_rate = totals.route_candidate > 0
      ? Number((totals.route_attempted / totals.route_candidate).toFixed(4))
      : 0;

    totals.suppression_rate = (totals.route_candidate > 0 || totals.detected > 0)
      ? Number((totals.route_suppressed_total / Math.max(1, totals.route_candidate || totals.detected)).toFixed(4))
      : 0;

    totals.route_failure_rate = totals.route_attempted > 0
      ? Number((totals.route_failed / totals.route_attempted).toFixed(4))
      : 0;

    totals.cooldown_share = totals.route_suppressed_total > 0
      ? Number((totals.route_suppressed_cooldown / totals.route_suppressed_total).toFixed(4))
      : 0;

    totals.duplicate_window_share = totals.route_suppressed_total > 0
      ? Number((totals.route_suppressed_duplicate_window / totals.route_suppressed_total).toFixed(4))
      : 0;

    return {
      window_minutes: sinceMinutes,
      bucket_minutes: bucketMinutes,
      sample_size: sampleSize,
      bucket_count: buckets.length,
      filters: {
        run_id: runId || null,
        source: source || null
      },
      totals,
      buckets
    };
  }

  // ========== Deploy Run Event Analytics ==========

  async ensureDeployRunEventsTable() {
    if (!this.deployEventsReadyPromise) {
      this.deployEventsReadyPromise = (async () => {
        await this.postgres.query(
          `CREATE TABLE IF NOT EXISTS deploy_run_events (
             id BIGSERIAL PRIMARY KEY,
             run_id UUID,
             source VARCHAR(80) NOT NULL,
             level VARCHAR(16) NOT NULL,
             event VARCHAR(120) NOT NULL,
             event_ts TIMESTAMP WITH TIME ZONE NOT NULL,
             payload JSONB DEFAULT '{}',
             created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
           )`
        );

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_deploy_run_events_run_ts
             ON deploy_run_events(run_id, event_ts DESC)`
        );

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_deploy_run_events_event
             ON deploy_run_events(event)`
        );

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_deploy_run_events_created
             ON deploy_run_events(created_at DESC)`
        );
      })().catch((err) => {
        this.deployEventsReadyPromise = null;
        throw err;
      });
    }

    return this.deployEventsReadyPromise;
  }

  async listDeployRunEvents({
    runId = null,
    event = null,
    level = null,
    sinceMinutes = null,
    limit = 100
  } = {}) {
    await this.ensureDeployRunEventsTable();

    let query = `SELECT id, run_id, source, level, event, event_ts, payload, created_at
                 FROM deploy_run_events
                 WHERE 1=1`;
    const params = [];

    if (runId) {
      params.push(runId);
      query += ` AND run_id = $${params.length}`;
    }

    if (event) {
      params.push(event);
      query += ` AND event = $${params.length}`;
    }

    if (level) {
      params.push(level);
      query += ` AND level = $${params.length}`;
    }

    if (Number.isInteger(sinceMinutes) && sinceMinutes > 0) {
      params.push(sinceMinutes);
      query += ` AND event_ts >= NOW() - ($${params.length} * INTERVAL '1 minute')`;
    }

    params.push(limit);
    query += ` ORDER BY event_ts DESC LIMIT $${params.length}`;

    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async summarizeDeployRunEvents({ sinceMinutes = 60, runId = null } = {}) {
    await this.ensureDeployRunEventsTable();

    let query = `SELECT event, level,
                        COUNT(*)::int AS count,
                        MIN(event_ts) AS first_seen,
                        MAX(event_ts) AS last_seen
                 FROM deploy_run_events
                 WHERE event_ts >= NOW() - ($1 * INTERVAL '1 minute')`;
    const params = [sinceMinutes];

    if (runId) {
      params.push(runId);
      query += ` AND run_id = $${params.length}`;
    }

    query += ` GROUP BY event, level ORDER BY count DESC, event ASC`;

    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async summarizeDeployRuns({
    sinceMinutes = 240,
    runId = null,
    source = null,
    limit = 50
  } = {}) {
    await this.ensureDeployRunEventsTable();

    let query = `SELECT run_id,
                        source,
                        MIN(event_ts) AS first_event_at,
                        MAX(event_ts) AS last_event_at,
                        COUNT(*)::int AS total_events,
                        COUNT(*) FILTER (WHERE level = 'error')::int AS error_events,
                        COUNT(*) FILTER (WHERE level = 'warn')::int AS warn_events,
                        COUNT(*) FILTER (WHERE level = 'info')::int AS info_events,
                        COUNT(*) FILTER (WHERE level = 'debug')::int AS debug_events
                 FROM deploy_run_events
                 WHERE event_ts >= NOW() - ($1 * INTERVAL '1 minute')`;

    const params = [sinceMinutes];

    if (runId) {
      params.push(runId);
      query += ` AND run_id = $${params.length}`;
    }

    if (source) {
      params.push(source);
      query += ` AND source = $${params.length}`;
    }

    query += ` GROUP BY run_id, source
               ORDER BY MAX(event_ts) DESC
               LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async getDeployEventTimeline({
    sinceMinutes = 240,
    bucketMinutes = 15,
    runId = null,
    source = null,
    limit = 1000
  } = {}) {
    await this.ensureDeployRunEventsTable();

    let query = `SELECT run_id,
                        source,
                        to_timestamp(FLOOR(EXTRACT(EPOCH FROM event_ts) / ($1 * 60)) * ($1 * 60)) AS bucket_start,
                        COUNT(*)::int AS total_events,
                        COUNT(*) FILTER (WHERE level = 'error')::int AS error_events,
                        COUNT(*) FILTER (WHERE level = 'warn')::int AS warn_events,
                        COUNT(*) FILTER (WHERE level = 'info')::int AS info_events,
                        COUNT(*) FILTER (WHERE level = 'debug')::int AS debug_events
                 FROM deploy_run_events
                 WHERE event_ts >= NOW() - ($2 * INTERVAL '1 minute')`;

    const params = [bucketMinutes, sinceMinutes];

    if (runId) {
      params.push(runId);
      query += ` AND run_id = $${params.length}`;
    }

    if (source) {
      params.push(source);
      query += ` AND source = $${params.length}`;
    }

    query += ` GROUP BY run_id, source, bucket_start
               ORDER BY bucket_start DESC, run_id NULLS LAST
               LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  async getDeployEventHeatmap({
    sinceMinutes = 240,
    runId = null,
    source = null,
    limit = 200
  } = {}) {
    await this.ensureDeployRunEventsTable();

    let query = `SELECT event,
                        COUNT(*) FILTER (WHERE level = 'error')::int AS error_count,
                        COUNT(*) FILTER (WHERE level = 'warn')::int AS warn_count,
                        COUNT(*) FILTER (WHERE level = 'info')::int AS info_count,
                        COUNT(*) FILTER (WHERE level = 'debug')::int AS debug_count,
                        COUNT(*)::int AS total_count
                 FROM deploy_run_events
                 WHERE event_ts >= NOW() - ($1 * INTERVAL '1 minute')`;

    const params = [sinceMinutes];

    if (runId) {
      params.push(runId);
      query += ` AND run_id = $${params.length}`;
    }

    if (source) {
      params.push(source);
      query += ` AND source = $${params.length}`;
    }

    query += ` GROUP BY event
               ORDER BY (COUNT(*) FILTER (WHERE level = 'error') + COUNT(*) FILTER (WHERE level = 'warn')) DESC,
                        COUNT(*) DESC,
                        event ASC
               LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.postgres.query(query, params);
    return result.rows;
  }

  // ========== Scheduler Support ==========

  async listUserIds(limit = 100) {
    const result = await this.postgres.query(
      `SELECT user_id FROM user_profiles ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(r => r.user_id);
  }

  async getLatestKbiSnapshot(userId) {
    const metrics = ['goal_adherence', 'engagement_score', 'mood_trend', 'skill_progress'];
    const snapshot = {};

    for (const metric of metrics) {
      const result = await this.postgres.query(
        `SELECT metric_value FROM kbi_metrics
         WHERE user_id = $1 AND metric_name = $2
         ORDER BY recorded_at DESC
         LIMIT 1`,
        [userId, metric]
      );

      if (result.rows[0]) {
        snapshot[metric] = Number(result.rows[0].metric_value);
      }
    }

    return snapshot;
  }

  // ========== Utility Methods ==========

  // ========== Connection Pool Monitoring ==========

  getPoolMetrics() {
    const poolStatus = {
      postgres: {
        total: this.postgres.totalCount,
        idle: this.postgres.idleCount,
        waiting: this.postgres.waitingCount,
        max: this.postgres.options.max
      },
      redis: {
        status: this.redis.status,
        reconnectAttempts: this.redis.reconnectAttempts || 0
      }
    };

    // Calculate utilization ratio
    poolStatus.postgres.utilization = poolStatus.postgres.total > 0
      ? (poolStatus.postgres.total - poolStatus.postgres.idle) / poolStatus.postgres.total
      : 0;

    // Health check
    poolStatus.healthy = {
      postgres: poolStatus.postgres.waiting < 5 && poolStatus.postgres.utilization < 0.9,
      redis: poolStatus.redis.status === 'ready'
    };

    poolStatus.healthy.overall = poolStatus.healthy.postgres && poolStatus.healthy.redis;

    return poolStatus;
  }

  async testConnections() {
    try {
      // Test Redis
      await this.redis.ping();
      console.log('✅ Redis connected');

      // Test PostgreSQL
      await this.postgres.query('SELECT NOW()');
      console.log('✅ PostgreSQL connected');

      return { redis: true, postgres: true };
    } catch (error) {
      console.error('❌ Database connection error:', error);
      return { redis: false, postgres: false, error: error.message };
    }
  }

  async close() {
    await this.redis.quit();
    await this.postgres.end();
    console.log('Database connections closed');
  }
}

module.exports = DatabaseStorageManager;