-- Life Coach AI Database Schema
-- Database: life_coach
-- Created: 2026-02-26

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 用戶畫像表 (LTM)
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    profile_data JSONB NOT NULL DEFAULT '{}',
    
    -- 索引
    CONSTRAINT valid_profile CHECK (jsonb_typeof(profile_data) = 'object')
);

CREATE INDEX idx_user_profiles_telegram ON user_profiles(telegram_id);
CREATE INDEX idx_user_profiles_updated ON user_profiles(updated_at);

-- 對話會話表 (STM/MTM)
CREATE TABLE conversations (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_status ON conversations(status);

-- 對話消息表 (STM)
CREATE TABLE messages (
    message_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES conversations(session_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    agent_id VARCHAR(50),  -- 哪個Agent生成的回應
    metadata JSONB DEFAULT '{}',
    importance_score FLOAT CHECK (importance_score >= 0 AND importance_score <= 1)
);

CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);

-- 行為模式表 (MTM)
CREATE TABLE behavior_patterns (
    pattern_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL CHECK (pattern_type IN ('communication', 'decision', 'learning', 'emotional', 'activity')),
    pattern_data JSONB NOT NULL,
    confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
    first_observed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_observed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    occurrence_count INTEGER DEFAULT 1
);

CREATE INDEX idx_patterns_user ON behavior_patterns(user_id);
CREATE INDEX idx_patterns_type ON behavior_patterns(pattern_type);
ALTER TABLE behavior_patterns ADD CONSTRAINT uq_behavior_user_type UNIQUE (user_id, pattern_type);

-- 用戶目標表 (LTM)
CREATE TABLE goals (
    goal_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    domain VARCHAR(50) NOT NULL CHECK (domain IN ('career', 'health', 'finance', 'skill', 'relationship', 'decision')),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'abandoned')),
    progress FLOAT DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    target_date DATE,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_goals_user ON goals(user_id);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_domain ON goals(domain);

-- KBI指標表 (MTM)
CREATE TABLE kbi_metrics (
    metric_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    metric_name VARCHAR(50) NOT NULL CHECK (metric_name IN ('goal_adherence', 'engagement_score', 'mood_trend', 'skill_progress')),
    metric_value FLOAT NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    period VARCHAR(20) DEFAULT 'daily' CHECK (period IN ('daily', 'weekly', 'monthly'))
);

CREATE INDEX idx_kbi_user ON kbi_metrics(user_id);
CREATE INDEX idx_kbi_name ON kbi_metrics(metric_name);
CREATE INDEX idx_kbi_recorded ON kbi_metrics(recorded_at);

-- 用戶偏好表 (MTM)
CREATE TABLE user_preferences (
    preference_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL CHECK (category IN ('communication_style', 'advice_type', 'reminder_frequency', 'depth_level')),
    preference_value JSONB NOT NULL,
    source VARCHAR(20) DEFAULT 'inferred' CHECK (source IN ('explicit', 'inferred', 'default')),
    stability_score FLOAT CHECK (stability_score >= 0 AND stability_score <= 1),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_preferences_user ON user_preferences(user_id);
ALTER TABLE user_preferences ADD CONSTRAINT uq_pref_user_category UNIQUE (user_id, category);

-- 里程碑表 (LTM)
CREATE TABLE milestones (
    milestone_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    milestone_type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    impact_score FLOAT CHECK (impact_score >= 0 AND impact_score <= 1),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_milestones_user ON milestones(user_id);

-- Agent運行日誌表 (用於監控)
CREATE TABLE agent_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    agent_id VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES user_profiles(user_id),
    session_id UUID,
    action VARCHAR(100) NOT NULL,
    duration_ms INTEGER,
    status VARCHAR(20) CHECK (status IN ('success', 'failure', 'timeout')),
    error_message TEXT,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_agent_logs_time ON agent_logs(timestamp);
CREATE INDEX idx_agent_logs_agent ON agent_logs(agent_id);

-- 觸發函數：自動更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 為需要自動更新的表添加觸發器
CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 添加一些註釋
COMMENT ON TABLE user_profiles IS '用戶核心畫像，長期存儲';
COMMENT ON TABLE conversations IS '對話會話，中期存儲';
COMMENT ON TABLE messages IS '對話消息，短期存儲';
COMMENT ON TABLE behavior_patterns IS '行為模式識別結果';
COMMENT ON TABLE goals IS '用戶目標追踪';
COMMENT ON TABLE kbi_metrics IS '關鍵行為指標';
COMMENT ON TABLE user_preferences IS '用戶偏好學習';
COMMENT ON TABLE milestones IS '用戶關鍵人生里程碑';

-- 完成
SELECT 'Database schema initialized successfully' AS status;