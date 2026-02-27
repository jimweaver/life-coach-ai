#!/usr/bin/env node

/**
 * Test skill-learning module
 */

const skillLearning = require('./core/skill-learning');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testDetectIntent() {
  // English patterns
  assert(skillLearning.detectIntent('create a skill for email') === true, 'should detect "create a skill"');
  assert(skillLearning.detectIntent('design skill to send slack') === true, 'should detect "design skill"');
  assert(skillLearning.detectIntent('building a new skill') === true, 'should detect "building a skill"');
  
  // Chinese patterns
  assert(skillLearning.detectIntent('寫個skill發郵件') === true, 'should detect "寫個skill"');
  assert(skillLearning.detectIntent('創建一個 skill for notifications') === true, 'should detect "創建一個 skill"');
  assert(skillLearning.detectIntent('設計個skill') === true, 'should detect "設計個skill"');
  
  // Negative cases
  assert(skillLearning.detectIntent('what is your favorite skill?') === false, 'should not detect skill as noun only');
  assert(skillLearning.detectIntent('I have a skill in programming') === false, 'should not detect possession');
  assert(skillLearning.detectIntent('') === false, 'should not detect empty string');
  assert(skillLearning.detectIntent(null) === false, 'should not detect null');
  
  console.log('✅ detectIntent tests passed');
}

function testExtractDescription() {
  const desc1 = skillLearning.extractDescription('create a skill for sending emails');
  assert(desc1.includes('sending emails'), 'should extract description');
  assert(!desc1.includes('create'), 'should remove trigger words');
  
  const desc2 = skillLearning.extractDescription('寫個skill發郵件');
  assert(desc2.includes('發郵件'), 'should extract Chinese description');
  
  console.log('✅ extractDescription tests passed');
}

function testBuildResponse() {
  // Error case
  const errorResult = {
    detected: true,
    error: 'Test error'
  };
  const errorResponse = skillLearning.buildResponse(errorResult);
  assert(errorResponse.type === 'skill_learning_error', 'should return error type');
  assert(errorResponse.message.includes('遇到'), 'should include Chinese error message');
  
  // Success case
  const successResult = {
    detected: true,
    description: 'send emails',
    report: 'Test report content',
    keywords: ['send', 'emails']
  };
  const successResponse = skillLearning.buildResponse(successResult);
  assert(successResponse.type === 'skill_learning_report', 'should return report type');
  assert(successResponse.message.includes('分析報告'), 'should include report header');
  
  console.log('✅ buildResponse tests passed');
}

async function testAnalyzeIntegration() {
  // Test with real learning (if billgates workspace available)
  const result = skillLearning.analyze('create a skill for gmail search');
  
  if (result) {
    assert(result.detected === true, 'should detect intent');
    assert(typeof result.description === 'string', 'should have description');
    
    if (result.report) {
      assert(typeof result.report === 'string', 'should have report string');
      console.log('✅ analyze with learning passed (report generated)');
    } else {
      console.log('⚠️ analyze passed but no report (billgates workspace may be unavailable)');
    }
  } else {
    console.log('❌ analyze should have detected intent');
    process.exit(1);
  }
}

async function run() {
  console.log('Running skill-learning tests...\n');
  
  try {
    testDetectIntent();
    testExtractDescription();
    testBuildResponse();
    await testAnalyzeIntegration();
    
    console.log('\n✅ All skill-learning tests passed');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
