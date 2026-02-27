# Life Coach AI

**版本**: v0.1.0 (MVP-Core)  
**日期**: 2026-02-26  
**目標**: 14-Agent Multi-Agent Life Coach 系統

---

## 項目結構

```
workspace-life-coach-v2/
├── agents/                    # Agent 定義
│   ├── orchestrator/          # Main Orchestrator (Codex 3.6)
│   ├── context-memory/        # Context Memory (Kimi K2.5)
│   ├── safety-guardian/       # Safety Guardian (Opus 4-6)
│   └── career-coach/          # Career Coach (Kimi K2.5)
├── core/                      # 核心邏輯
├── memory/                    # 記憶系統
│   ├── stm/                   # 短期記憶
│   ├── mtm/                   # 中期記憶
│   └── ltm/                   # 長期記憶
├── storage/                   # 存儲配置
│   ├── redis/                 # Redis 配置
│   ├── postgres/              # PostgreSQL 配置
│   └── qdrant/                # Qdrant 配置
├── tests/                     # 測試
├── config/                    # 配置文件
└── docs/                      # 文檔
```

---

## 14個 Agents 設計

### 4個核心 (常駐)
| # | Agent | 模型 | 狀態 |
|---|-------|------|------|
| 1 | Main Orchestrator | Codex 3.6 | 常駐 |
| 8 | Context Memory | Kimi K2.5 | 常駐 |
| 14 | Safety Guardian | Opus 4-6 | 常駐 |
| 2 | Career Coach | Kimi K2.5 | 常駐/按需 |

### 10個擴展 (按需)
| # | Agent | 類型 |
|---|-------|------|
| 3 | Health Coach | Domain |
| 4 | Finance Coach | Domain |
| 5 | Skill Coach | Domain |
| 6 | Relationship Coach | Domain |
| 7 | Decision Coach | Domain |
| 9 | Data Collector | Shared |
| 10 | Progress Tracker | Shared |
| 11 | Conflict Resolver | Shared |
| 12 | KBI Monitor | Supervisory |
| 13 | Intervention | Supervisory |

---

## 技術棧

### Agents
- **Main Orchestrator**: OpenAI Codex 3.6
- **Safety Guardian**: Anthropic Opus 4-6
- **其他**: Kimi K2.5

### 存儲
- **STM (短期記憶)**: Redis
- **MTM (中期記憶)**: PostgreSQL
- **LTM (長期記憶)**: S3/MinIO
- **Vector (向量記憶)**: Qdrant

### 基礎設施
- Docker + Docker Compose
- OpenClaw Multi-Agent System

---

## 快速開始

### 啟動數據庫
```bash
docker-compose up -d redis postgres qdrant
```

### 創建 Agents
```bash
# 核心4個
openclaw agent create --config agents/orchestrator/config.yaml
openclaw agent create --config agents/context-memory/config.yaml
openclaw agent create --config agents/safety-guardian/config.yaml
openclaw agent create --config agents/career-coach/config.yaml
```

### 運行測試
```bash
npm test
```

---

## 開發路線圖

- **Week 1**: 4個核心 Agents ✅
- **Week 2**: +3 Domain Agents
- **Week 3**: +2 Domain + 2 Shared
- **Week 4**: 剩餘3個 Agents

---

**狀態**: 🚧 Day 1 - 項目設置中