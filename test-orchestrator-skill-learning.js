#!/usr/bin/env node

/**
 * Test skill-learning integration in orchestrator
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const OrchestratorEngine = require('./core/orchestrator-engine');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log('Testing skill-learning orchestrator integration...\n');

  const engine = new OrchestratorEngine();
  await engine.init();

  try {
    // Test 1: Normal domain processing (no skill intent)
    console.log('Test 1: Normal domain processing...');
    const normalResult = await engine.process({
      userId: uuidv4(),
      input: '我想轉職做軟件工程師'
    });
    assert(normalResult.mode !== 'skill_learning', 'normal input should not trigger skill learning');
    assert(normalResult.output.length > 0, 'should have output');
    console.log('✅ Normal processing works');

    // Test 2: Skill creation intent (English)
    console.log('\nTest 2: Skill creation intent (English)...');
    const skillResult = await engine.process({
      userId: uuidv4(),
      input: 'create a skill for searching gmail'
    });
    assert(skillResult.mode === 'skill_learning', 'should detect skill learning mode');
    assert(skillResult.skill_learning?.detected === true, 'should have skill_learning metadata');
    assert(skillResult.output.includes('分析報告') || skillResult.output.includes('skill'), 'should contain analysis report');
    console.log('✅ Skill learning detection works (English)');

    // Test 3: Skill creation intent (Chinese)
    console.log('\nTest 3: Skill creation intent (Chinese)...');
    const chineseResult = await engine.process({
      userId: uuidv4(),
      input: '寫個skill發郵件'
    });
    assert(chineseResult.mode === 'skill_learning', 'should detect skill learning mode (Chinese)');
    assert(chineseResult.skill_learning?.detected === true, 'should have skill_learning metadata');
    console.log('✅ Skill learning detection works (Chinese)');

    // Test 4: Conversation persistence for skill learning
    console.log('\nTest 4: Conversation persistence...');
    const userId = uuidv4();
    const skillResult2 = await engine.process({
      userId,
      input: 'design a skill for calendar events'
    });
    assert(skillResult2.mode === 'skill_learning', 'should be skill learning mode');
    
    // Check conversation was persisted
    const session = await engine.db.getSession(skillResult2.session_id);
    assert(!!session, 'session should exist');
    console.log('✅ Conversation persisted correctly');

    console.log('\n✅ All orchestrator skill-learning integration tests passed');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  } finally {
    await engine.db.close();
  }
}

run();
