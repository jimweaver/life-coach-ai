# 數據庫設置指南

## 開發環境 (無 Docker)

由於當前機器未安裝 Docker，我們使用 **文件系統模擬** 進行開發。

### 文件系統存儲方案

```
memory/
├── stm/                    # 短期記憶 (模擬 Redis)
│   └── sessions/
│       └── {session_id}.json
├── mtm/                    # 中期記憶 (模擬 PostgreSQL)
│   ├── users/
│   │   └── {user_id}.json
│   ├── conversations/
│   │   └── {session_id}.json
│   └── patterns/
│       └── {user_id}.json
└── ltm/                    # 長期記憶 (模擬 S3)
    └── {user_id}/
        ├── profile.json
        ├── goals.json
        └── milestones/
            └── {year}/
                └── {month}.json
```

### 生產環境部署

#### 1. 安裝 Docker

```bash
# macOS
brew install docker docker-compose

# 或下載 Docker Desktop
# https://www.docker.com/products/docker-desktop
```

#### 2. 啟動數據庫

```bash
cd /Users/tj/.openclaw/workspace-life-coach-v2
docker-compose up -d
```

#### 3. 驗證服務

```bash
# Redis
docker exec life-coach-redis redis-cli ping
# 預期輸出: PONG

# PostgreSQL
docker exec life-coach-postgres pg_isready -U coach
# 預期輸出: /var/run/postgresql:5432 - accepting connections

# Qdrant
curl http://localhost:6333/healthz
# 預期輸出: {"status":"ok"}
```

#### 4. 數據庫連接信息

| 服務 | 主機 | 端口 | 用戶 | 密碼 | 數據庫 |
|------|------|------|------|------|--------|
| Redis | localhost | 6379 | - | - | 0 |
| PostgreSQL | localhost | 5432 | coach | coach_password_2024 | life_coach |
| Qdrant | localhost | 6333 | - | - | - |

---

## 開發階段使用文件系統

### FileStorageManager 實現

```javascript
// core/storage/file-storage.js
class FileStorageManager {
  constructor(basePath) {
    this.basePath = basePath;
  }
  
  // STM - 短期記憶
  async getSTM(sessionId) {
    const file = path.join(this.basePath, 'stm', 'sessions', `${sessionId}.json`);
    return this.readJSON(file);
  }
  
  async setSTM(sessionId, data, ttl = 86400) {
    const file = path.join(this.basePath, 'stm', 'sessions', `${sessionId}.json`);
    await this.writeJSON(file, { data, expires: Date.now() + ttl * 1000 });
  }
  
  // MTM - 中期記憶
  async getUserProfile(userId) {
    const file = path.join(this.basePath, 'mtm', 'users', `${userId}.json`);
    return this.readJSON(file);
  }
  
  async updateUserProfile(userId, updates) {
    const file = path.join(this.basePath, 'mtm', 'users', `${userId}.json`);
    const existing = await this.readJSON(file) || {};
    await this.writeJSON(file, { ...existing, ...updates, updated_at: new Date() });
  }
  
  // LTM - 長期記憶
  async getLTM(userId, key) {
    const file = path.join(this.basePath, 'ltm', userId, `${key}.json`);
    return this.readJSON(file);
  }
  
  async setLTM(userId, key, data) {
    const dir = path.join(this.basePath, 'ltm', userId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${key}.json`);
    await this.writeJSON(file, data);
  }
  
  // Helper methods
  async readJSON(file) {
    try {
      const data = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(data);
      // Check TTL for STM
      if (parsed.expires && parsed.expires < Date.now()) {
        return null;
      }
      return parsed.data || parsed;
    } catch {
      return null;
    }
  }
  
  async writeJSON(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }
}

module.exports = FileStorageManager;
```

---

## 遷移到生產數據庫

### 1. 數據遷移腳本

```javascript
// scripts/migrate-to-production.js
async function migrateToProduction() {
  const fileStorage = new FileStorageManager('./memory');
  const redis = new Redis();
  const postgres = new PostgresClient();
  
  // Migrate STM
  const stmFiles = await glob('./memory/stm/sessions/*.json');
  for (const file of stmFiles) {
    const data = await fileStorage.readJSON(file);
    const sessionId = path.basename(file, '.json');
    await redis.setex(`session:${sessionId}`, 86400, JSON.stringify(data));
  }
  
  // Migrate MTM
  const userFiles = await glob('./memory/mtm/users/*.json');
  for (const file of userFiles) {
    const data = await fileStorage.readJSON(file);
    const userId = path.basename(file, '.json');
    await postgres.query(
      'INSERT INTO user_profiles (user_id, profile_data) VALUES ($1, $2)',
      [userId, data]
    );
  }
  
  console.log('Migration completed!');
}
```

### 2. 環境變量配置

```bash
# .env.production
REDIS_URL=redis://localhost:6379/0
POSTGRES_URL=postgresql://coach:password@localhost:5432/life_coach
QDRANT_URL=http://localhost:6333
S3_BUCKET=life-coach-ltm
```

---

## 狀態

- [x] 數據庫 Schema 設計完成
- [x] Docker Compose 配置完成
- [ ] Docker 服務啟動 (需要安裝 Docker)
- [x] 文件系統備選方案就緒

**下一步**: 安裝 Docker 後運行 `docker-compose up -d`