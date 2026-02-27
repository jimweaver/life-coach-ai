const { Pool } = require('pg');

class DeployEventSink {
  constructor(options = {}) {
    this.runId = options.runId || null;
    this.mode = String(options.mode ?? process.env.DEPLOY_WRAPPER_EVENT_SINK ?? 'postgres').toLowerCase();
    this.tableName = options.tableName || process.env.DEPLOY_WRAPPER_EVENT_TABLE || 'deploy_run_events';
    this.source = options.source || process.env.DEPLOY_WRAPPER_EVENT_SOURCE || 'deploy-wrapper';
    this.enabled = this.mode !== 'none';

    this.connectionString = options.connectionString || process.env.DATABASE_URL || null;
    this.pool = null;
    this.readyPromise = null;

    this.stats = {
      writes: 0,
      failed_writes: 0,
      last_error: null
    };

    if (this.enabled && this.mode === 'postgres' && this.connectionString) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        max: Number(process.env.DEPLOY_WRAPPER_EVENT_POOL_MAX || 2),
        idleTimeoutMillis: Number(process.env.DEPLOY_WRAPPER_EVENT_POOL_IDLE_MS || 5000),
        connectionTimeoutMillis: Number(process.env.DEPLOY_WRAPPER_EVENT_POOL_CONN_MS || 2000)
      });
    }
  }

  status() {
    return {
      enabled: this.enabled,
      mode: this.mode,
      ready: !!this.pool,
      table: this.tableName,
      source: this.source,
      writes: this.stats.writes,
      failed_writes: this.stats.failed_writes,
      last_error: this.stats.last_error
    };
  }

  async ensureTable() {
    if (!this.pool) return;

    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.pool.query(
          `CREATE TABLE IF NOT EXISTS ${this.tableName} (
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

        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_run_ts
             ON ${this.tableName}(run_id, event_ts DESC)`
        );

        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_event
             ON ${this.tableName}(event)`
        );
      })().catch((err) => {
        this.readyPromise = null;
        throw err;
      });
    }

    await this.readyPromise;
  }

  async write(payload = {}) {
    if (!this.enabled) {
      return { stored: false, reason: 'disabled' };
    }

    if (this.mode !== 'postgres') {
      return { stored: false, reason: `unsupported_mode:${this.mode}` };
    }

    if (!this.pool) {
      return { stored: false, reason: 'pool_unavailable' };
    }

    try {
      await this.ensureTable();

      const eventTs = payload.ts ? new Date(payload.ts) : new Date();
      const level = String(payload.level || 'info').slice(0, 16);
      const event = String(payload.event || 'unknown').slice(0, 120);

      await this.pool.query(
        `INSERT INTO ${this.tableName} (run_id, source, level, event, event_ts, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          this.runId,
          this.source,
          level,
          event,
          eventTs,
          JSON.stringify(payload || {})
        ]
      );

      this.stats.writes += 1;
      return { stored: true };
    } catch (err) {
      this.stats.failed_writes += 1;
      this.stats.last_error = err.message;
      return { stored: false, reason: err.message };
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

module.exports = DeployEventSink;
