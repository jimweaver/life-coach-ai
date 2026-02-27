class DataCollector {
  constructor() {
    this.braveApiKey = process.env.BRAVE_API_KEY || null;
    this.braveEndpoint = 'https://api.search.brave.com/res/v1/web/search';
  }

  async searchBrave(query, count = 3) {
    if (!this.braveApiKey) return null;

    const url = new URL(this.braveEndpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));

    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.braveApiKey
      }
    });

    if (!res.ok) {
      throw new Error(`Brave API failed: ${res.status}`);
    }

    const data = await res.json();
    const results = (data?.web?.results || []).slice(0, count).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description
    }));

    return {
      provider: 'brave',
      query,
      results
    };
  }

  fallbackSnapshot(domain, input) {
    const generic = {
      provider: 'fallback',
      query: `${domain}:${input}`,
      results: [
        {
          title: 'No external source configured',
          url: null,
          description: 'BRAVE_API_KEY not set; using local heuristic knowledge.'
        }
      ]
    };

    if (domain === 'career') {
      generic.results.push({
        title: 'Career fallback heuristic',
        url: null,
        description: 'Focus on JD gap analysis + portfolio outputs + measurable milestones.'
      });
    }

    if (domain === 'finance') {
      generic.results.push({
        title: 'Finance fallback heuristic',
        url: null,
        description: 'Prioritize cashflow safety and emergency fund before major transition spend.'
      });
    }

    if (domain === 'health') {
      generic.results.push({
        title: 'Health fallback heuristic',
        url: null,
        description: 'Prioritize sleep regularity and sustainable stress reduction routines.'
      });
    }

    return generic;
  }

  async getDomainSnapshot(domain, input) {
    const queryByDomain = {
      career: `${input} career market trend hiring skills`,
      health: `${input} stress sleep evidence based recommendations`,
      finance: `${input} budgeting cashflow risk management`,
      skill: `${input} learning roadmap best practices`,
      relationship: `${input} communication conflict resolution framework`,
      decision: `${input} decision framework risk tradeoff`
    };

    const q = queryByDomain[domain] || input;

    try {
      const external = await this.searchBrave(q, 3);
      if (external) return external;
      return this.fallbackSnapshot(domain, input);
    } catch (_e) {
      return this.fallbackSnapshot(domain, input);
    }
  }
}

module.exports = DataCollector;
