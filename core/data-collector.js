class DataCollector {
  constructor(options = {}) {
    this.braveApiKey = options.braveApiKey ?? process.env.BRAVE_API_KEY ?? null;
    this.braveEndpoint = 'https://api.search.brave.com/res/v1/web/search';

    this.queryByDomain = {
      career: (input) => `${input} career market trend hiring skills`,
      health: (input) => `${input} stress sleep evidence based recommendations`,
      finance: (input) => `${input} budgeting cashflow risk management`,
      skill: (input) => `${input} learning roadmap best practices`,
      relationship: (input) => `${input} communication conflict resolution framework`,
      decision: (input) => `${input} decision framework risk tradeoff`
    };

    this.domainHints = {
      career: ['career', 'job', 'hiring', 'resume', '職涯', '轉職', '面試', '履歷'],
      health: ['health', 'sleep', 'stress', 'wellness', '健康', '睡眠', '壓力'],
      finance: ['finance', 'money', 'budget', 'cashflow', '財務', '預算', '投資'],
      skill: ['skill', 'learning', 'course', 'practice', '技能', '學習', '課程'],
      relationship: ['relationship', 'communication', 'conflict', '人際', '關係', '溝通'],
      decision: ['decision', 'tradeoff', 'risk', 'framework', '決定', '取捨', '兩難']
    };
  }

  tokenize(text = '') {
    return String(text)
      .toLowerCase()
      .replace(/[\n\r\t]/g, ' ')
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .filter(Boolean);
  }

  keywordOverlapScore(query, content) {
    const qTokens = Array.from(new Set(this.tokenize(query))).filter((t) => t.length >= 2);
    const cTokens = new Set(this.tokenize(content));

    if (!qTokens.length || !cTokens.size) return 0;

    const hit = qTokens.reduce((acc, t) => acc + (cTokens.has(t) ? 1 : 0), 0);
    return hit / qTokens.length;
  }

  authorityScore(url) {
    if (!url) return 0.25;

    try {
      const host = new URL(url).hostname.toLowerCase();
      if (/(^|\.)gov\b/.test(host)) return 1.0;
      if (/(^|\.)edu\b/.test(host)) return 0.95;
      if (host.includes('who.int') || host.includes('nih.gov')) return 0.95;
      if (host.includes('github.com') || host.includes('openclaw.ai') || host.includes('docs.')) return 0.85;
      if (host.includes('wikipedia.org') || host.includes('investopedia.com')) return 0.8;
      return 0.65;
    } catch (_e) {
      return 0.3;
    }
  }

  domainHintScore(domain, content) {
    const hints = this.domainHints[domain] || [];
    if (!hints.length) return 0;
    const lower = String(content || '').toLowerCase();
    const hit = hints.reduce((acc, kw) => acc + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0);
    return Math.min(1, hit / 4);
  }

  scoreResult(domain, query, result) {
    const text = `${result.title || ''} ${result.description || ''}`.trim();

    const relevance = this.keywordOverlapScore(query, text);
    const authority = this.authorityScore(result.url);
    const domainFit = this.domainHintScore(domain, text);

    const blended = (relevance * 0.5) + (authority * 0.3) + (domainFit * 0.2);
    const normalized = Math.max(0.05, Math.min(0.99, blended));

    return {
      relevance: Number(relevance.toFixed(3)),
      authority: Number(authority.toFixed(3)),
      domain_fit: Number(domainFit.toFixed(3)),
      score: Number(normalized.toFixed(3)),
      confidence: Number((0.25 + normalized * 0.75).toFixed(3))
    };
  }

  rankResults(domain, query, results = []) {
    const ranked = results
      .map((r) => {
        const metrics = this.scoreResult(domain, query, r);
        let sourceHost = null;

        try {
          sourceHost = r.url ? new URL(r.url).hostname : null;
        } catch (_e) {
          sourceHost = null;
        }

        return {
          title: r.title || 'Untitled source',
          url: r.url || null,
          description: r.description || '',
          source_host: sourceHost,
          ...metrics
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((item, idx) => ({
        ...item,
        rank: idx + 1
      }));

    return ranked;
  }

  buildSnapshot({ provider, domain, query, rankedResults, mode, reason = null }) {
    const top = rankedResults.slice(0, 3);
    const confidence = top.length
      ? Number((top.reduce((sum, item) => sum + item.confidence, 0) / top.length).toFixed(3))
      : 0.2;

    return {
      provider,
      mode,
      domain,
      query,
      generated_at: new Date().toISOString(),
      confidence,
      reason,
      total_results: rankedResults.length,
      citations: top.map((x) => ({
        rank: x.rank,
        title: x.title,
        url: x.url,
        source_host: x.source_host,
        confidence: x.confidence
      })),
      results: top
    };
  }

  async searchBrave(query, count = 5) {
    if (!this.braveApiKey) return null;

    const url = new URL(this.braveEndpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));

    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.braveApiKey
      }
    });

    if (!res.ok) {
      throw new Error(`Brave API failed: ${res.status}`);
    }

    const data = await res.json();
    return (data?.web?.results || []).slice(0, count).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description
    }));
  }

  fallbackSnapshot(domain, input, reason = 'BRAVE_API_KEY not set') {
    const base = [
      {
        title: 'No external source configured',
        url: null,
        description: `Fallback mode enabled: ${reason}`
      }
    ];

    const domainSpecific = {
      career: [
        {
          title: 'Career fallback heuristic',
          url: null,
          description: 'Focus on JD gap analysis + portfolio outputs + measurable milestones.'
        },
        {
          title: 'Transition risk checklist',
          url: null,
          description: 'Set runway, interview pipeline, and skill plan before role transition.'
        }
      ],
      finance: [
        {
          title: 'Finance fallback heuristic',
          url: null,
          description: 'Prioritize cashflow safety and emergency fund before transition spend.'
        },
        {
          title: 'Budget-first transition policy',
          url: null,
          description: 'Use monthly burn-rate control and cap optional learning spend.'
        }
      ],
      health: [
        {
          title: 'Health fallback heuristic',
          url: null,
          description: 'Prioritize sleep regularity and sustainable stress-reduction routines.'
        },
        {
          title: 'Low-overhead baseline routine',
          url: null,
          description: 'Start with manageable habit loops before high-intensity interventions.'
        }
      ],
      skill: [
        {
          title: 'Skill fallback heuristic',
          url: null,
          description: 'Use 30/60/90 learning sprints with portfolio-first milestones.'
        }
      ],
      relationship: [
        {
          title: 'Relationship fallback heuristic',
          url: null,
          description: 'Use low-conflict communication scripts and clear shared outcomes.'
        }
      ],
      decision: [
        {
          title: 'Decision fallback heuristic',
          url: null,
          description: 'Compare options by impact, risk, reversibility, and timing window.'
        }
      ]
    };

    const query = (this.queryByDomain[domain] || ((x) => x))(input);
    const ranked = this.rankResults(domain, query, [
      ...base,
      ...(domainSpecific[domain] || [])
    ]);

    return this.buildSnapshot({
      provider: 'fallback',
      mode: 'fallback',
      domain,
      query,
      rankedResults: ranked,
      reason
    });
  }

  async getDomainSnapshot(domain, input) {
    const queryBuilder = this.queryByDomain[domain] || ((x) => x);
    const query = queryBuilder(input);

    try {
      const rawExternal = await this.searchBrave(query, 5);
      if (rawExternal && rawExternal.length) {
        const ranked = this.rankResults(domain, query, rawExternal);
        return this.buildSnapshot({
          provider: 'brave',
          mode: 'external',
          domain,
          query,
          rankedResults: ranked
        });
      }

      return this.fallbackSnapshot(domain, input, 'No external results');
    } catch (err) {
      return this.fallbackSnapshot(domain, input, err.message || 'External fetch failed');
    }
  }
}

module.exports = DataCollector;
