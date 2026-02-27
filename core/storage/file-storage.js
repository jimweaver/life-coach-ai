const fs = require('fs').promises;
const path = require('path');

/**
 * File-based Storage Manager
 * 開發階段使用文件系統模擬數據庫
 * 生產環境遷移到 Redis/PostgreSQL/S3
 */
class FileStorageManager {
  constructor(basePath = '/Users/tj/.openclaw/workspace-life-coach-v2/memory') {
    this.basePath = basePath;
    this.initDirectories();
  }

  async initDirectories() {
    const dirs = [
      'stm/sessions',
      'mtm/users',
      'mtm/conversations',
      'mtm/patterns',
      'mtm/goals',
      'mtm/kbi',
      'ltm/profiles',
      'ltm/milestones'
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(this.basePath, dir), { recursive: true });
    }
  }

  // ========== STM (Short Term Memory) - 模擬 Redis ==========
  
  async getSession(sessionId) {
    const file = path.join(this.basePath, 'stm', 'sessions', `${sessionId}.json`);
    const data = await this.readJSON(file);
    
    if (data && data.expires && data.expires < Date.now()) {
      await fs.unlink(file).catch(() => {});
      return null;
    }
    
    return data?.data || data;
  }

  async setSession(sessionId, data, ttlSeconds = 86400) {
    const file = path.join(this.basePath, 'stm', 'sessions', `${sessionId}.json`);
    await this.writeJSON(file, {
      data,
      expires: Date.now() + ttlSeconds * 1000,
      created_at: new Date().toISOString()
    });
  }

  async deleteSession(sessionId) {
    const file = path.join(this.basePath, 'stm', 'sessions', `${sessionId}.json`);
    await fs.unlink(file).catch(() => {});
  }

  // ========== MTM (Medium Term Memory) - 模擬 PostgreSQL ==========

  async getUserProfile(userId) {
    const file = path.join(this.basePath, 'mtm', 'users', `${userId}.json`);
    return await this.readJSON(file);
  }

  async updateUserProfile(userId, updates) {
    const file = path.join(this.basePath, 'mtm', 'users', `${userId}.json`);
    const existing = await this.readJSON(file) || {
      user_id: userId,
      created_at: new Date().toISOString()
    };
    
    const updated = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString()
    };
    
    await this.writeJSON(file, updated);
    return updated;
  }

  async getConversation(sessionId) {
    const file = path.join(this.basePath, 'mtm', 'conversations', `${sessionId}.json`);
    return await this.readJSON(file);
  }

  async saveConversation(sessionId, conversation) {
    const file = path.join(this.basePath, 'mtm', 'conversations', `${sessionId}.json`);
    await this.writeJSON(file, conversation);
  }

  async addMessage(sessionId, message) {
    const file = path.join(this.basePath, 'mtm', 'conversations', `${sessionId}.json`);
    const conversation = await this.readJSON(file) || {
      session_id: sessionId,
      messages: [],
      started_at: new Date().toISOString()
    };
    
    conversation.messages.push({
      ...message,
      timestamp: new Date().toISOString()
    });
    
    await this.writeJSON(file, conversation);
  }

  async getBehaviorPatterns(userId) {
    const file = path.join(this.basePath, 'mtm', 'patterns', `${userId}.json`);
    const data = await this.readJSON(file);
    return data?.patterns || [];
  }

  async saveBehaviorPattern(userId, pattern) {
    const file = path.join(this.basePath, 'mtm', 'patterns', `${userId}.json`);
    const data = await this.readJSON(file) || { patterns: [] };
    
    data.patterns.push({
      ...pattern,
      created_at: new Date().toISOString()
    });
    
    await this.writeJSON(file, data);
  }

  async getGoals(userId) {
    const file = path.join(this.basePath, 'mtm', 'goals', `${userId}.json`);
    const data = await this.readJSON(file);
    return data?.goals || [];
  }

  async saveGoal(userId, goal) {
    const file = path.join(this.basePath, 'mtm', 'goals', `${userId}.json`);
    const data = await this.readJSON(file) || { goals: [] };
    
    const existingIndex = data.goals.findIndex(g => g.goal_id === goal.goal_id);
    if (existingIndex >= 0) {
      data.goals[existingIndex] = { ...data.goals[existingIndex], ...goal };
    } else {
      data.goals.push({
        goal_id: require('uuid').v4(),
        ...goal,
        created_at: new Date().toISOString()
      });
    }
    
    await this.writeJSON(file, data);
  }

  async getKBIMetrics(userId, metricName) {
    const file = path.join(this.basePath, 'mtm', 'kbi', `${userId}.json`);
    const data = await this.readJSON(file);
    return data?.metrics?.[metricName] || [];
  }

  async recordKBIMetric(userId, metricName, value) {
    const file = path.join(this.basePath, 'mtm', 'kbi', `${userId}.json`);
    const data = await this.readJSON(file) || { metrics: {} };
    
    if (!data.metrics[metricName]) {
      data.metrics[metricName] = [];
    }
    
    data.metrics[metricName].push({
      value,
      recorded_at: new Date().toISOString()
    });
    
    await this.writeJSON(file, data);
  }

  // ========== LTM (Long Term Memory) - 模擬 S3 ==========

  async getLTM(userId, key) {
    const file = path.join(this.basePath, 'ltm', 'profiles', userId, `${key}.json`);
    return await this.readJSON(file);
  }

  async setLTM(userId, key, data) {
    const dir = path.join(this.basePath, 'ltm', 'profiles', userId);
    await fs.mkdir(dir, { recursive: true });
    
    const file = path.join(dir, `${key}.json`);
    await this.writeJSON(file, {
      ...data,
      updated_at: new Date().toISOString()
    });
  }

  async addMilestone(userId, milestone) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    const dir = path.join(this.basePath, 'ltm', 'milestones', userId, String(year));
    await fs.mkdir(dir, { recursive: true });
    
    const file = path.join(dir, `${month}.json`);
    const data = await this.readJSON(file) || { milestones: [] };
    
    data.milestones.push({
      ...milestone,
      milestone_id: require('uuid').v4(),
      date: date.toISOString()
    });
    
    await this.writeJSON(file, data);
  }

  // ========== Helper Methods ==========

  async readJSON(file) {
    try {
      const data = await fs.readFile(file, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async writeJSON(file, data) {
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }

  // ========== 清理過期數據 ==========

  async cleanExpiredSTM() {
    const sessionsDir = path.join(this.basePath, 'stm', 'sessions');
    
    try {
      const files = await fs.readdir(sessionsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(sessionsDir, file);
          const data = await this.readJSON(filePath);
          
          if (data && data.expires && data.expires < Date.now()) {
            await fs.unlink(filePath);
            console.log(`Deleted expired session: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning expired sessions:', error);
    }
  }
}

module.exports = FileStorageManager;