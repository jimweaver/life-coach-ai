/**
 * Skill Learning Hook for Life Coach AI
 * 
 * Usage:
 *   const skillLearning = require('./skill-learning');
 *   
 *   // In orchestrator or message handler:
 *   const result = skillLearning.analyze(userInput);
 *   if (result) {
 *     // Skill creation detected
 *     return skillLearning.buildResponse(result);
 *   }
 */

const { execSync } = require('child_process');
const path = require('path');

const BILLGATES_WORKSPACE = '/Users/tj/.openclaw/workspace-billgates';
const LEARN_SCRIPT = path.join(BILLGATES_WORKSPACE, 'skill-learn.js');

// Keywords that trigger skill learning
const TRIGGER_KEYWORDS = [
  // English
  'create a skill', 'create skill', 'creating a skill', 'creating skill',
  'design a skill', 'design skill', 'designing a skill', 'designing skill',
  'build a skill', 'build skill', 'building a skill', 'building skill',
  'new skill',
  'skill for', 'skill to', 'skill that',
  'skill development', 'develop skill', 'developing skill',
  // Chinese - variations with/without spaces
  '寫個skill', '寫個 skill', '寫skill', '寫 skill', '寫一個skill', '寫一個 skill',
  '創建skill', '創建 skill', '創建個skill', '創建個 skill', '創建一個skill', '創建一個 skill',
  '設計skill', '設計 skill', '設計個skill', '設計個 skill', '設計一個skill', '設計一個 skill',
  '建立skill', '建立 skill', '建立個skill', '建立個 skill', '建立一個skill', '建立一個 skill'
];

/**
 * Check if input indicates skill creation intent
 */
function detectIntent(input) {
  if (!input || typeof input !== 'string') return false;
  const lower = input.toLowerCase();
  
  // Check exact keyword matches
  if (TRIGGER_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) {
    return true;
  }
  
  // Check Chinese pattern: [創建/建立/設計/寫] ... skill
  const chinesePattern = /(創建|建立|設計|寫).{0,100}skill/i;
  if (chinesePattern.test(input)) {
    return true;
  }
  
  // Check English pattern: create/design/build ... skill
  const englishPattern = /(create|design|build|develop).{0,100}\bskill\b/i;
  if (englishPattern.test(input)) {
    return true;
  }
  
  return false;
}

/**
 * Extract the skill description from user input
 */
function extractDescription(input) {
  let desc = input;
  for (const kw of TRIGGER_KEYWORDS) {
    desc = desc.replace(new RegExp(kw, 'gi'), '');
  }
  return desc.trim().replace(/\s+/g, ' ');
}

/**
 * Run skill learning analysis
 */
function learn(description) {
  try {
    const result = execSync(
      `node "${LEARN_SCRIPT}" "${description.replace(/"/g, '\\"')}"`,
      {
        cwd: BILLGATES_WORKSPACE,
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    return result;
  } catch (error) {
    console.error('[SkillLearning] Error:', error.message);
    return null;
  }
}

/**
 * Main analysis function
 */
function analyze(userInput) {
  if (!detectIntent(userInput)) {
    return null;
  }

  const description = extractDescription(userInput);
  const report = learn(description);

  if (!report) {
    return {
      detected: true,
      description: description,
      report: null,
      error: 'Failed to generate learning report'
    };
  }

  return {
    detected: true,
    description: description,
    report: report,
    keywords: description.split(' ').slice(0, 5)
  };
}

/**
 * Build a formatted response for the user
 */
function buildResponse(result) {
  if (!result || !result.detected) {
    return null;
  }

  if (result.error) {
    return {
      type: 'skill_learning_error',
      message: '我檢測到你想創建一個 skill，但在分析過程中遇到了問題。請稍後再試。',
      error: result.error
    };
  }

  return {
    type: 'skill_learning_report',
    message: '我檢測到你想創建一個 skill！這是我的分析報告：\n\n' + result.report,
    description: result.description,
    keywords: result.keywords
  };
}

/**
 * Quick check - just detect intent without running analysis
 */
function checkIntent(userInput) {
  return detectIntent(userInput);
}

/**
 * Get learning report for a specific description
 */
function getReport(description) {
  return learn(description);
}

module.exports = {
  analyze,
  buildResponse,
  checkIntent,
  getReport,
  detectIntent,
  extractDescription
};
