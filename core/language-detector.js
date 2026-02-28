/**
 * Language Detection and Localization Module
 * Multi-language support for Life Coach AI
 */

class LanguageDetector {
  constructor() {
    // Language patterns for detection
    this.languagePatterns = {
      'zh-Hant': {
        name: 'Traditional Chinese',
        nameNative: '繁體中文',
        patterns: [/[一-鿿]/, /[㐀-䶿]/],
        commonWords: ['的', '是', '在', '有', '和', '不', '了', '說', '對', '為', '與', '這', '個', '們', '時', '後', '會', '他', '她', '它'],
        traditionalChars: ['說', '對', '為', '與', '這', '個', '們', '時', '後', '會', '國', '問', '學', '體', '見', '進', '過', '開', '實', '長', '裡', '經', '當', '種', '從', '還', '話', '點', '兩', '樣', '愛', '現', '車', '頭', '間', '員', '來', '區', '讓', '給'],
        confidenceThreshold: 0.3
      },
      'zh-Hans': {
        name: 'Simplified Chinese',
        nameNative: '简体中文',
        patterns: [/[一-鿿]/, /[㐀-䶿]/],
        commonWords: ['的', '是', '在', '有', '和', '不', '了', '说', '对', '为', '与', '这', '个', '们', '时', '后', '会', '他', '她', '它'],
        simplifiedChars: ['说', '对', '为', '与', '这', '个', '们', '时', '后', '会', '国', '问', '学', '体', '见', '进', '过', '开', '实', '长', '里', '经', '当', '种', '从', '还', '话', '点', '两', '样', '爱', '现', '车', '头', '间', '员', '来', '区', '让', '给'],
        confidenceThreshold: 0.3
      },
      'yue': {
        name: 'Cantonese',
        nameNative: '廣東話',
        patterns: [/[一-鿿]/],
        commonWords: ['哦', '喺', '咗', '喀', '喲', '嗎', '咩', '唔', '係', '咤'],
        particles: ['咗', '喀', '喲', '嗎', '咩', '唔', '嘅'],
        confidenceThreshold: 0.5
      },
      'en': {
        name: 'English',
        nameNative: 'English',
        patterns: [/[a-zA-Z]/],
        commonWords: ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'I', 'is', 'it', 'for', 'was', 'on', 'are', 'as', 'with', 'his', 'they', 'at', 'be', 'this', 'from', 'or', 'one', 'had', 'by', 'word', 'but'],
        confidenceThreshold: 0.3
      },
      'ja': {
        name: 'Japanese',
        nameNative: '日本語',
        patterns: [/[぀-ゟ]/, /[゠-ヿ]/, /[一-龯]/],
        commonWords: ['の', 'です', 'ます', 'と', 'に', 'を', 'は', 'が', 'も', 'よ', 'て', 'で', 'た', 'し', 'な', 'か', 'い', 'う', 'え', 'お'],
        confidenceThreshold: 0.3
      },
      'ko': {
        name: 'Korean',
        nameNative: '한국어',
        patterns: [/[가-힯]/, /[ᄀ-ᇿ]/],
        commonWords: ['의', '이', '어', '의', '에', '를', '와', '하', '있', '아', '은', '는', '로', '으로', '고', '도', '다', '게', '서', '나'],
        confidenceThreshold: 0.3
      }
    };

    // Response templates for different languages
    this.templates = {
      'zh-Hant': {
        greetings: {
          morning: '早安！今天有什麼我可以幫助你的嗎？',
          afternoon: '下午好！有什麼想聊的嗎？',
          evening: '晚上好！今天過得怎麼樣？',
          generic: '你好！我是你的生活教練。有什麼我可以幫助你的嗎？'
        },
        followUp: {
          askMore: '還有什麼想分享的嗎？',
          clarification: '可以說說更多細節嗎？',
          encouragement: '這是個好開始！我們一起繼續努力。'
        },
        safety: {
          crisis: '我聽到你現在非常辛苦。你的安全是最重要的。如果你有即時危險，請馬上撥 999 或去最近的急診室。你不需要一個人面對。',
          resources: '這裡有一些可以幫助你的資源：'
        },
        domainHeaders: {
          career: '【職涯】',
          health: '【健康】',
          finance: '【財務】',
          skill: '【技能】',
          relationship: '【人際】',
          decision: '【決策】'
        },
        recommendations: '建議：',
        constraints: '注意事項：',
        confidence: '置信度',
        sources: '參考來源'
      },
      'yue': {
        greetings: {
          morning: '早晨！今日有唔有甚麼我可以幫你？',
          afternoon: '下昼好！有唔有甚麼想聊？',
          evening: '夜晚好！今日過得點呀？',
          generic: '你好！我係你的生活教練。有唔有甚麼我可以幫你？'
        },
        followUp: {
          askMore: '仲有唔甚麼想分享？',
          clarification: '可唔可以講多唔少細節？',
          encouragement: '這個係個好開始！我地一齊努力。'
        },
        safety: {
          crisis: '我聽到你而家好辛苦。你的安全係最重要。如果你有即時危險，請馬上打 999 或去最近急診室。你唔係一個人面對。',
          resources: '這度有些資源可以幫你：'
        },
        domainHeaders: {
          career: '【職涯】',
          health: '【健康】',
          finance: '【財務】',
          skill: '【技能】',
          relationship: '【人際】',
          decision: '【決策】'
        },
        recommendations: '建議：',
        constraints: '注意事項：',
        confidence: '置信度',
        sources: '參考來源'
      },
      'en': {
        greetings: {
          morning: 'Good morning! What can I help you with today?',
          afternoon: 'Good afternoon! What\'s on your mind?',
          evening: 'Good evening! How was your day?',
          generic: 'Hello! I\'m your Life Coach. What can I help you with?'
        },
        followUp: {
          askMore: 'Is there anything else you\'d like to share?',
          clarification: 'Could you tell me more details?',
          encouragement: 'This is a great start! Let\'s keep working on it together.'
        },
        safety: {
          crisis: 'I hear that you\'re in a lot of pain right now. Your safety is the most important thing. If you\'re in immediate danger, please call emergency services or go to the nearest emergency room. You don\'t have to face this alone.',
          resources: 'Here are some resources that can help you:'
        },
        domainHeaders: {
          career: '[CAREER]',
          health: '[HEALTH]',
          finance: '[FINANCE]',
          skill: '[SKILLS]',
          relationship: '[RELATIONSHIPS]',
          decision: '[DECISIONS]'
        },
        recommendations: 'Recommendations:',
        constraints: 'Considerations:',
        confidence: 'Confidence',
        sources: 'Sources'
      }
    };

    // Default language
    this.defaultLanguage = 'zh-Hant';
  }

  /**
   * Detect language of input text
   * @param {string} text - Input text
   * @returns {Object} - Detected language with confidence
   */
  detect(text) {
    if (!text || typeof text !== 'string') {
      return { code: this.defaultLanguage, confidence: 1.0 };
    }

    const scores = {};
    const textLower = text.toLowerCase();

    for (const [langCode, config] of Object.entries(this.languagePatterns)) {
      let score = 0;
      let matches = 0;

      // Check character patterns
      for (const pattern of config.patterns) {
        const matchCount = (text.match(pattern) || []).length;
        if (matchCount > 0) {
          matches += matchCount;
          score += 0.3;
        }
      }

      // Check common words
      if (config.commonWords) {
        const wordMatches = config.commonWords.filter(word => 
          textLower.includes(word.toLowerCase())
        ).length;
        score += (wordMatches / config.commonWords.length) * 0.4;
      }

      // Special handling for Cantonese particles
      if (langCode === 'yue' && config.particles) {
        const particleMatches = config.particles.filter(p => 
          text.includes(p)
        ).length;
        if (particleMatches > 0) {
          score += 0.3;
        }
      }

      // Special handling for Traditional vs Simplified Chinese
      if (langCode === 'zh-Hant' && config.traditionalChars) {
        const tradMatches = config.traditionalChars.filter(c => text.includes(c)).length;
        if (tradMatches > 0) {
          score += 0.3;
        }
      }

      if (langCode === 'zh-Hans' && config.simplifiedChars) {
        const simpMatches = config.simplifiedChars.filter(c => text.includes(c)).length;
        if (simpMatches > 0) {
          score += 0.3;
        }
      }

      // Special handling for English - check if mostly ASCII
      if (langCode === 'en') {
        const asciiCount = (text.match(/[a-zA-Z]/g) || []).length;
        const totalChars = text.replace(/\s/g, '').length;
        if (totalChars > 0 && asciiCount / totalChars > 0.5) {
          score += 0.3;
        }
      }

      // Special handling for Korean - check for Hangul
      if (langCode === 'ko') {
        const hangulCount = (text.match(/[가-힯]/g) || []).length;
        if (hangulCount > 0) {
          score += 0.4;
        }
      }

      // Normalize score
      scores[langCode] = Math.min(score, 1.0);
    }

    // Find best match
    let bestLang = this.defaultLanguage;
    let bestScore = 0;

    for (const [lang, score] of Object.entries(scores)) {
      const threshold = this.languagePatterns[lang].confidenceThreshold;
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestLang = lang;
      }
    }

    return {
      code: bestLang,
      confidence: bestScore,
      allScores: scores
    };
  }

  /**
   * Get template for specific language
   * @param {string} langCode - Language code
   * @param {string} category - Template category
   * @param {string} key - Template key
   * @returns {string|Object} - Template string or object
   */
  getTemplate(langCode, category, key) {
    const lang = this.templates[langCode] || this.templates[this.defaultLanguage];
    const cat = lang[category];
    if (!cat) return null;
    // If key provided, return specific value; otherwise return whole category
    return key ? cat[key] : cat;
  }

  /**
   * Format greeting based on time and language
   * @param {string} langCode - Language code
   * @param {Date} date - Date object (defaults to now)
   * @returns {string} - Greeting message
   */
  getGreeting(langCode, date = new Date()) {
    const hour = date.getHours();
    let timeKey = 'generic';
    
    if (hour >= 5 && hour < 12) {
      timeKey = 'morning';
    } else if (hour >= 12 && hour < 18) {
      timeKey = 'afternoon';
    } else if (hour >= 18 && hour < 22) {
      timeKey = 'evening';
    }

    return this.getTemplate(langCode, 'greetings', timeKey);
  }

  /**
   * Get domain header for language
   * @param {string} langCode - Language code
   * @param {string} domain - Domain name
   * @returns {string} - Domain header
   */
  getDomainHeader(langCode, domain) {
    const headers = this.getTemplate(langCode, 'domainHeaders');
    return headers ? headers[domain] || `[${domain.toUpperCase()}]` : `[${domain.toUpperCase()}]`;
  }

  /**
   * Format response with language-appropriate structure
   * @param {string} langCode - Language code
   * @param {Object} content - Response content
   * @returns {string} - Formatted response
   */
  formatResponse(langCode, content) {
    const t = this.templates[langCode] || this.templates[this.defaultLanguage];
    
    let response = '';
    
    // Add domain header if present
    if (content.domain) {
      response += `${this.getDomainHeader(langCode, content.domain)}\n`;
    }
    
    // Add summary
    if (content.summary) {
      response += `${content.summary}\n\n`;
    }
    
    // Add recommendations
    if (content.recommendations && content.recommendations.length > 0) {
      response += `${t.recommendations}\n`;
      content.recommendations.forEach((rec, i) => {
        response += `${i + 1}. ${rec}\n`;
      });
      response += '\n';
    }
    
    // Add constraints
    if (content.constraints && content.constraints.length > 0) {
      response += `${t.constraints}\n`;
      content.constraints.forEach(constraint => {
        response += `- ${constraint}\n`;
      });
      response += '\n';
    }
    
    // Add confidence
    if (content.confidence) {
      response += `${t.confidence}: ${Math.round(content.confidence * 100)}%\n`;
    }
    
    return response.trim();
  }

  /**
   * Get supported languages
   * @returns {Array} - List of supported language codes
   */
  getSupportedLanguages() {
    return Object.keys(this.templates);
  }

  /**
   * Check if language is supported
   * @param {string} langCode - Language code
   * @returns {boolean} - Whether supported
   */
  isSupported(langCode) {
    return langCode in this.templates;
  }
}

module.exports = LanguageDetector;
