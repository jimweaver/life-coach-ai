const Redis = require('ioredis');
const { Pool } = require('pg');
const { normalizeAuditEvent } = require('../audit-log');

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

    console.log('✅ DatabaseStorageManager initialized');
  }

  // ========== STM (Short Term Memory) - Redis ==========

  async getSession(sessionId) {
    const data = await this.redis.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  async setSession(sessionId, data, ttlSeconds = 86400) {
    await this.redis.setex(
      `session:${sessionId}`,
      ttlSeconds,
      JSON.stringify(data)
    );
  }

  async deleteSession(sessionId) {
    await this.redis.del(`session:${sessionId}`);
  }

  async extendSessionTTL(sessionId, ttlSeconds = 86400) {
    await this.redis.expire(`session:${sessionId}`, ttlSeconds);
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
             status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'dispatched', 'failed')),
             payload JSONB DEFAULT '{}',
             delivery_metadata JSONB DEFAULT '{}',
             error_message TEXT
           )`
        );

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_outbound_events_status_created
             ON outbound_events(status, created_at DESC)`
        );

        await this.postgres.query(
          `CREATE INDEX IF NOT EXISTS idx_outbound_events_user
             ON outbound_events(user_id)`
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

  async markOutboundEventDispatched(eventId, metadata = {}) {
    await this.ensureOutboxTable();

    await this.postgres.query(
      `UPDATE outbound_events
       SET status = 'dispatched',
           dispatched_at = NOW(),
           delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb) || $2::jsonb,
           error_message = NULL
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