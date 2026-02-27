const KBIMonitor = require('./core/kbi-monitor');
const InterventionEngine = require('./core/intervention-engine');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(function run() {
  const monitor = new KBIMonitor();
  const intervention = new InterventionEngine();

  const eval1 = monitor.evaluateSnapshot({
    goal_adherence: 0.35,
    engagement_score: 2,
    mood_trend: 2.2,
    skill_progress: 0.1
  });

  assert(eval1.hasCritical, 'expected critical alert');
  const msg = intervention.buildRiskIntervention(eval1.alerts);
  assert(!!msg, 'expected intervention message');

  const morning = intervention.buildMorningCheckIn({ profile: { name: 'TJ' } });
  assert(morning.includes('TJ'), 'expected user name in morning checkin');

  console.log('✅ kbi/intervention test passed');
})();
