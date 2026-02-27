const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

class AgentLoader {
  constructor(baseDir = path.join(__dirname, '..', 'agents')) {
    this.baseDir = baseDir;
    this.cache = new Map();
  }

  async loadAgentConfig(agentFolder) {
    const configPath = path.join(this.baseDir, agentFolder, 'config.yaml');
    const raw = await fs.readFile(configPath, 'utf8');
    const config = yaml.load(raw);

    if (!config?.agent_id || !config?.name || !config?.model) {
      throw new Error(`Invalid config: ${configPath}`);
    }

    this.cache.set(config.agent_id, config);
    return config;
  }

  async loadCoreAgents() {
    const coreFolders = [
      'orchestrator',
      'context-memory',
      'safety-guardian',
      'career-coach'
    ];

    const results = {};
    for (const folder of coreFolders) {
      const cfg = await this.loadAgentConfig(folder);
      results[cfg.agent_id] = cfg;
    }

    return results;
  }

  async loadAllAgents() {
    const folders = await fs.readdir(this.baseDir, { withFileTypes: true });
    const results = {};

    for (const entry of folders) {
      if (!entry.isDirectory()) continue;

      const folder = entry.name;
      const configPath = path.join(this.baseDir, folder, 'config.yaml');

      try {
        await fs.access(configPath);
        const cfg = await this.loadAgentConfig(folder);
        results[cfg.agent_id] = cfg;
      } catch {
        // skip missing configs
      }
    }

    return results;
  }

  getFromCache(agentId) {
    return this.cache.get(agentId) || null;
  }

  async validateAgentConfig(config) {
    const errors = [];

    if (!config.agent_id) errors.push('Missing agent_id');
    if (!config.name) errors.push('Missing name');
    if (!config.model) errors.push('Missing model');
    if (!config.system_prompt) errors.push('Missing system_prompt');

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = AgentLoader;
