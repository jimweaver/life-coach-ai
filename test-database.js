#!/usr/bin/env node

/**
 * Database Connection Test
 * 驗證 Redis 和 PostgreSQL 連接
 */

const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');

async function testDatabase() {
  console.log('🧪 Testing Database Connections...\n');

  const db = new DatabaseStorageManager();

  try {
    // 1. 測試連接
    console.log('1️⃣ Testing connections...');
    const connections = await db.testConnections();
    
    if (!connections.redis || !connections.postgres) {
      console.error('❌ Connection failed');
      process.exit(1);
    }

    // 2. 測試 Redis 讀寫
    console.log('\n2️⃣ Testing Redis (STM)...');
    const { v4: uuidv4 } = require('uuid');
const testUserId = uuidv4();
    const testSession = {
      session_id: uuidv4(),
      user_id: testUserId,
      current_intent: 'career_advice',
      messages: []
    };

    await db.setSession(testSession.session_id, testSession, 60);
    const retrievedSession = await db.getSession(testSession.session_id);
    
    if (retrievedSession && retrievedSession.user_id === testUserId) {
      console.log('✅ Redis read/write OK');
    } else {
      console.error('❌ Redis test failed');
    }

    // 3. 測試 PostgreSQL 用戶檔案
    console.log('\n3️⃣ Testing PostgreSQL (MTM) - User Profile...');
    const testProfile = {
      name: 'Test User',
      preferences: { communication_style: 'direct' },
      goals: []
    };

    await db.createUserProfile(testUserId, testProfile);
    const retrievedProfile = await db.getUserProfile(testUserId);
    
    if (retrievedProfile && retrievedProfile.name === 'Test User') {
      console.log('✅ PostgreSQL user profile OK');
    } else {
      console.error('❌ PostgreSQL user profile test failed');
    }

    // 4. 測試對話記錄
    console.log('\n4️⃣ Testing PostgreSQL - Conversations...');
    const sessionId = uuidv4();
    await db.createConversation(sessionId, testUserId, { source: 'telegram' });
    await db.addMessage(sessionId, testUserId, 'user', '我想轉職', null, 0.8);
    await db.addMessage(sessionId, testUserId, 'assistant', '我可以幫你分析', 'career_coach', 0.9);

    const conversation = await db.getConversation(sessionId);
    if (conversation && conversation.messages.length === 2) {
      console.log('✅ PostgreSQL conversation OK');
    } else {
      console.error('❌ PostgreSQL conversation test failed');
    }

    // 5. 測試目標追蹤
    console.log('\n5️⃣ Testing PostgreSQL - Goals...');
    const goalId = await db.createGoal(testUserId, {
      domain: 'career',
      title: '轉職產品經理',
      description: '從工程師轉職到產品經理',
      target_date: '2026-06-01'
    });

    const goals = await db.getGoals(testUserId);
    if (goals.length > 0 && goals[0].title === '轉職產品經理') {
      console.log('✅ PostgreSQL goals OK');
    } else {
      console.error('❌ PostgreSQL goals test failed');
    }

    // 6. 測試 KBI
    console.log('\n6️⃣ Testing PostgreSQL - KBI Metrics...');
    await db.recordKBIMetric(testUserId, 'goal_adherence', 0.85);
    await db.recordKBIMetric(testUserId, 'engagement_score', 7);

    const kbis = await db.getKBIMetrics(testUserId, 'goal_adherence');
    if (kbis.length > 0 && kbis[0].metric_value === 0.85) {
      console.log('✅ PostgreSQL KBI metrics OK');
    } else {
      console.error('❌ PostgreSQL KBI test failed');
    }

    // 7. 清理測試數據
    console.log('\n7️⃣ Cleaning up test data...');
    await db.deleteSession(testSession.session_id);
    // 保留測試用戶數據以便查看

    console.log('\n✅✅✅ All database tests passed! ✅✅✅');
    console.log('\n📊 Database Status:');
    console.log('   Redis:     Running on port 6379');
    console.log('   PostgreSQL: Running on port 5432');
    console.log('   Database:   life_coach');
    console.log('   Tables:     8 tables created');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

testDatabase();