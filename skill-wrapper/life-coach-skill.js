/**
 * Life Coach Skill - OpenClaw Integration
 * Allows any OpenClaw agent to use Life Coach AI
 */

const LIFE_COACH_API = process.env.LIFE_COACH_API_URL || 'http://localhost:8787';
const LIFE_COACH_KEY = process.env.LIFE_COACH_API_KEY || null;

class LifeCoachSkill {
  constructor(options = {}) {
    this.baseUrl = options.apiUrl || LIFE_COACH_API;
    this.apiKey = options.apiKey || LIFE_COACH_KEY;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Life Coach API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Get coaching advice
   */
  async chat({ userId, message, sessionId }) {
    if (!userId || !message) {
      throw new Error('userId and message are required');
    }

    return this.request('/chat', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        message,
        session_id: sessionId
      })
    });
  }

  /**
   * Get user profile
   */
  async getProfile(userId) {
    return this.request(`/profile/${userId}`);
  }

  /**
   * Update user profile
   */
  async updateProfile(userId, profileData) {
    return this.request(`/profile/${userId}`, {
      method: 'POST',
      body: JSON.stringify(profileData)
    });
  }

  /**
   * Get user goals
   */
  async getGoals(userId) {
    return this.request(`/goals/${userId}`);
  }

  /**
   * Set a goal
   */
  async setGoal(userId, goalData) {
    return this.request(`/goals/${userId}`, {
      method: 'POST',
      body: JSON.stringify(goalData)
    });
  }

  /**
   * Get KBI monitor data
   */
  async getMonitorData(userId) {
    return this.request(`/monitor/${userId}`);
  }

  /**
   * Trigger morning intervention
   */
  async getMorningIntervention(userId) {
    return this.request(`/intervention/morning/${userId}`);
  }

  /**
   * Run monitor cycle (admin)
   */
  async runMonitorCycle() {
    return this.request('/jobs/run-monitor-cycle', { method: 'POST' });
  }

  /**
   * Run morning cycle (admin)
   */
  async runMorningCycle() {
    return this.request('/jobs/run-morning-cycle', { method: 'POST' });
  }

  /**
   * Get system health
   */
  async getHealth() {
    return this.request('/health');
  }

  /**
   * Get full metrics dashboard
   */
  async getMetrics() {
    return this.request('/metrics/dashboard');
  }

  /**
   * Get Prometheus metrics
   */
  async getPrometheusMetrics() {
    const response = await fetch(`${this.baseUrl}/metrics/prometheus`);
    return response.text();
  }
}

module.exports = LifeCoachSkill;
