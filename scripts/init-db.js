#!/usr/bin/env node
/**
 * Database Initialization Script
 * Reads schema from storage/postgres/init.sql and executes against database
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load environment variables
require('dotenv').config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

async function initDatabase() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔌 Connecting to database...');
    const client = await pool.connect();
    
    // Read schema file
    const schemaPath = path.join(__dirname, '..', 'storage', 'postgres', 'init.sql');
    console.log(`📄 Reading schema from: ${schemaPath}`);
    
    if (!fs.existsSync(schemaPath)) {
      console.error(`❌ Schema file not found: ${schemaPath}`);
      process.exit(1);
    }
    
    const schemaSQL = fs.readFileSync(schemaPath, 'utf-8');
    
    console.log('🚀 Executing schema...');
    await client.query(schemaSQL);
    
    console.log('✅ Database initialized successfully');
    
    // Verify tables were created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n📊 Created tables:');
    result.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    client.release();
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase };
