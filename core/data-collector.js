class DataCollector {
  constructor(options = {}) {
    this.braveApiKey = options.braveApiKey ?? process.env.BRAVE_API_KEY ?? null;
    this.braveEndpoint = 'https://api.search.brave.com/res/v1/web/search';

    this.maxSourceAgeDays = Number(options.maxSourceAgeDays ?? process.env.DATA_COLLECTOR_MAX_SOURCE_AGE_DAYS ?? 1200);
    this.enableDedupe = options.enableDedupe ?? String(process.env.DATA_COLLECTOR_ENABLE_DEDUPE || 'true').toLowerCase() !== 'false';

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

  parsePublishedAt(value) {
    if (!value) return null;
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return null;
    return new Date(ts);
  }

  freshnessScore(publishedAt) {
    if (!publishedAt) return 0.45;

    const ageMs = Date.now() - publishedAt.getTime();
    if (ageMs < 0) return 0.6;

    const ageDays = ageMs / 86_400_000;

    if (ageDays <= 7) return 1;
    if (ageDays <= 30) return 0.9;
    if (ageDays <= 90) return 0.75;
    if (ageDays <= 180) return 0.6;
    if (ageDays <= 365) return 0.45;
    return 0.25;
  }

  isTooOld(publishedAt) {
    if (!publishedAt) return false;
    const ageDays = (Date.now() - publishedAt.getTime()) / 86_400_000;
    return ageDays > this.maxSourceAgeDays;
  }

  canonicalSourceKey(result = {}) {
    const title = String(result.title || '').trim().toLowerCase();
    const description = String(result.description || '').trim().toLowerCase();

    try {
      if (result.url) {
        const u = new URL(result.url);
        const host = u.hostname.toLowerCase();
        const path = u.pathname.replace(/\/+$/, '').toLowerCase() || '/';
        return `url:${host}${path}`;
      }
    } catch (_e) {
      // fallback below
    }

    const compact = `${title}|${description}`.replace(/\s+/g, ' ').slice(0, 180);
    return `text:${compact}`;
  }

  dedupeResults(results = []) {
    if (!this.enableDedupe) return results;

    const seen = new Set();
    const output = [];

    for (const item of results) {
      const key = this.canonicalSourceKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }

    return output;
  }

  normalizeExternalResult(result = {}) {
    const publishedAt = this.parsePublishedAt(result.publishedAt || result.age || result.published_time || result.page_age || null);

    return {
      title: result.title || 'Untitled source',
      url: result.url || null,
      description: result.description || '',
      published_at: publishedAt ? publishedAt.toISOString() : null,
      _publishedDate: publishedAt
    };
  }

  preprocessExternalResults(rawResults = []) {
    const normalized = rawResults.map((r) => this.normalizeExternalResult(r));

    const filteredByAge = normalized.filter((r) => !this.isTooOld(r._publishedDate));
    const deduped = this.dedupeResults(filteredByAge);

    return deduped;
  }

  scoreResult(domain, query, result) {
    const text = `${result.title || ''} ${result.description || ''}`.trim();

    const relevance = this.keywordOverlapScore(query, text);
    const authority = this.authorityScore(result.url);
    const domainFit = this.domainHintScore(domain, text);
    const freshness = this.freshnessScore(result._publishedDate || this.parsePublishedAt(result.published_at));

    const blended = (relevance * 0.45) + (authority * 0.25) + (domainFit * 0.15) + (freshness * 0.15);
    const normalized = Math.max(0.05, Math.min(0.99, blended));

    return {
      relevance: Number(relevance.toFixed(3)),
      authority: Number(authority.toFixed(3)),
      domain_fit: Number(domainFit.toFixed(3)),
      freshness: Number(freshness.toFixed(3)),
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
          published_at: r.published_at || null,
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

  buildSnapshot({ provider, domain, query, rankedResults, mode, reason = null, quality = {} }) {
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
      quality,
      citations: top.map((x) => ({
        rank: x.rank,
        title: x.title,
        url: x.url,
        source_host: x.source_host,
        published_at: x.published_at,
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
      description: r.description,
      publishedAt: r.age || r.page_age || r.published_at || r.published_time || null
    }));
  }

  fallbackSnapshot(domain, input, reason = 'BRAVE_API_KEY not set') {
    const base = [
      {
        title: 'No external source configured',
        url: null,
        description: `Fallback mode enabled: ${reason}`,
        published_at: null,
        _publishedDate: null
      }
    ];

    const domainSpecific = {
      career: [
        {
          title: 'Career fallback heuristic',
          url: null,
          description: 'Focus on JD gap analysis + portfolio outputs + measurable milestones.',
          published_at: null,
          _publishedDate: null
        },
        {
          title: 'Transition risk checklist',
          url: null,
          description: 'Set runway, interview pipeline, and skill plan before role transition.',
          published_at: null,
          _publishedDate: null
        }
      ],
      finance: [
        {
          title: 'Finance fallback heuristic',
          url: null,
          description: 'Prioritize cashflow safety and emergency fund before transition spend.',
          published_at: null,
          _publishedDate: null
        },
        {
          title: 'Budget-first transition policy',
          url: null,
          description: 'Use monthly burn-rate control and cap optional learning spend.',
          published_at: null,
          _publishedDate: null
        }
      ],
      health: [
        {
          title: 'Health fallback heuristic',
          url: null,
          description: 'Prioritize sleep regularity and sustainable stress-reduction routines.',
          published_at: null,
          _publishedDate: null
        },
        {
          title: 'Low-overhead baseline routine',
          url: null,
          description: 'Start with manageable habit loops before high-intensity interventions.',
          published_at: null,
          _publishedDate: null
        }
      ],
      skill: [
        {
          title: 'Skill fallback heuristic',
          url: null,
          description: 'Use 30/60/90 learning sprints with portfolio-first milestones.',
          published_at: null,
          _publishedDate: null
        }
      ],
      relationship: [
        {
          title: 'Relationship fallback heuristic',
          url: null,
          description: 'Use low-conflict communication scripts and clear shared outcomes.',
          published_at: null,
          _publishedDate: null
        }
      ],
      decision: [
        {
          title: 'Decision fallback heuristic',
          url: null,
          description: 'Compare options by impact, risk, reversibility, and timing window.',
          published_at: null,
          _publishedDate: null
        }
      ]
    };

    const query = (this.queryByDomain[domain] || ((x) => x))(input);
    const fallbackResults = [
      ...base,
      ...(domainSpecific[domain] || [])
    ];

    const ranked = this.rankResults(domain, query, fallbackResults);

    return this.buildSnapshot({
      provider: 'fallback',
      mode: 'fallback',
      domain,
      query,
      rankedResults: ranked,
      reason,
      quality: {
        dedupe_removed: 0,
        stale_removed: 0,
        freshness_enabled: false
      }
    });
  }

  async getDomainSnapshot(domain, input) {
    const queryBuilder = this.queryByDomain[domain] || ((x) => x);
    const query = queryBuilder(input);

    try {
      const rawExternal = await this.searchBrave(query, 8);
      if (rawExternal && rawExternal.length) {
        const beforeCount = rawExternal.length;
        const preprocessed = this.preprocessExternalResults(rawExternal);
        const staleRemoved = beforeCount - rawExternal.filter((r) => !this.isTooOld(this.parsePublishedAt(r.publishedAt || r.age || r.published_time || null))).length;
        const dedupeRemoved = Math.max(0, beforeCount - preprocessed.length - staleRemoved);

        if (!preprocessed.length) {
          return this.fallbackSnapshot(domain, input, 'All external results filtered by quality rules');
        }

        const ranked = this.rankResults(domain, query, preprocessed);
        return this.buildSnapshot({
          provider: 'brave',
          mode: 'external',
          domain,
          query,
          rankedResults: ranked,
          quality: {
            original_results: beforeCount,
            post_filter_results: preprocessed.length,
            stale_removed: staleRemoved,
            dedupe_removed: dedupeRemoved,
            freshness_enabled: true,
            max_source_age_days: this.maxSourceAgeDays
          }
        });
      }

      return this.fallbackSnapshot(domain, input, 'No external results');
    } catch (err) {
      return this.fallbackSnapshot(domain, input, err.message || 'External fetch failed');
    }
  }
}

module.exports = DataCollector;
