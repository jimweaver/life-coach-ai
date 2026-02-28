/**
 * Test suite for LanguageDetector
 */

const LanguageDetector = require('./core/language-detector');

async function runTests() {
  console.log('🧪 Testing LanguageDetector...\n');
  
  const detector = new LanguageDetector();
  let passed = 0;
  let failed = 0;

  // Test 1: Traditional Chinese detection
  console.log('Test 1: Traditional Chinese detection');
  const tcResult = detector.detect('我想轉職但擔心財務問題');
  if (tcResult.code === 'zh-Hant' && tcResult.confidence > 0.5) {
    console.log('  ✅ Passed:', tcResult);
    passed++;
  } else {
    console.log('  ❌ Failed:', tcResult);
    failed++;
  }

  // Test 2: Cantonese detection
  console.log('\nTest 2: Cantonese detection');
  const yueResult = detector.detect('我而家好辛苦，唔知點算');
  if (yueResult.code === 'yue' && yueResult.confidence > 0.5) {
    console.log('  ✅ Passed:', yueResult);
    passed++;
  } else {
    console.log('  ❌ Failed:', yueResult);
    failed++;
  }

  // Test 3: English detection
  console.log('\nTest 3: English detection');
  const enResult = detector.detect('I want to improve my career skills');
  if (enResult.code === 'en' && enResult.confidence > 0.5) {
    console.log('  ✅ Passed:', enResult);
    passed++;
  } else {
    console.log('  ❌ Failed:', enResult);
    failed++;
  }

  // Test 4: Japanese detection
  console.log('\nTest 4: Japanese detection');
  const jaResult = detector.detect('仕事のストレスが大変です');
  if (jaResult.code === 'ja' && jaResult.confidence > 0.5) {
    console.log('  ✅ Passed:', jaResult);
    passed++;
  } else {
    console.log('  ❌ Failed:', jaResult);
    failed++;
  }

  // Test 5: Korean detection
  console.log('\nTest 5: Korean detection');
  const koResult = detector.detect('직장에서 스트레스를 받고 있어요');
  if (koResult.code === 'ko' && koResult.confidence > 0.5) {
    console.log('  ✅ Passed:', koResult);
    passed++;
  } else {
    console.log('  ❌ Failed:', koResult);
    failed++;
  }

  // Test 6: Template retrieval
  console.log('\nTest 6: Template retrieval');
  const greeting = detector.getTemplate('en', 'greetings', 'morning');
  if (greeting && greeting.includes('Good morning')) {
    console.log('  ✅ Passed:', greeting);
    passed++;
  } else {
    console.log('  ❌ Failed:', greeting);
    failed++;
  }

  // Test 7: Domain header
  console.log('\nTest 7: Domain header');
  const header = detector.getDomainHeader('zh-Hant', 'career');
  if (header === '【職涯】') {
    console.log('  ✅ Passed:', header);
    passed++;
  } else {
    console.log('  ❌ Failed:', header);
    failed++;
  }

  // Test 8: Response formatting
  console.log('\nTest 8: Response formatting');
  const formatted = detector.formatResponse('en', {
    domain: 'career',
    summary: 'This is a summary',
    recommendations: ['Do this', 'Do that'],
    confidence: 0.85
  });
  if (formatted.includes('Recommendations:') && formatted.includes('Confidence: 85%')) {
    console.log('  ✅ Passed');
    passed++;
  } else {
    console.log('  ❌ Failed:', formatted);
    failed++;
  }

  // Test 9: Greeting by time
  console.log('\nTest 9: Greeting by time');
  const morningGreeting = detector.getGreeting('en', new Date('2024-01-01 09:00:00'));
  if (morningGreeting.includes('morning')) {
    console.log('  ✅ Passed:', morningGreeting);
    passed++;
  } else {
    console.log('  ❌ Failed:', morningGreeting);
    failed++;
  }

  // Test 10: Supported languages
  console.log('\nTest 10: Supported languages');
  const languages = detector.getSupportedLanguages();
  if (languages.includes('en') && languages.includes('zh-Hant')) {
    console.log('  ✅ Passed:', languages);
    passed++;
  } else {
    console.log('  ❌ Failed:', languages);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  return failed === 0;
}

if (require.main === module) {
  runTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { runTests };
