# 多AI協作生活教練系統 - 自我進化機制設計

## 系統概述

本設計為「多AI協作生活教練系統」提供完整的自我進化機制，確保系統能夠隨著使用時間越來越了解用戶，不斷提升建議品質，並自動發現用戶的行為模式和偏好變化。

---

## 1. 反饋迴路系統

### 1.1 用戶反饋收集機制

#### 1.1.1 顯性反饋收集

**反饋時機設計**
```python
class ExplicitFeedbackCollector:
    """
    顯性反饋收集器 - 在用戶自然的互動時機收集反饋
    """
    
    FEEDBACK_TRIGGERS = {
        # 建議執行後反饋
        'post_intervention': {
            'delay_hours': [24, 72, 168],  # 1天、3天、7天後
            'questions': [
                {'id': 'helpfulness', 'type': 'rating', 'scale': 5, 
                 'text': '這個建議對您有幫助嗎？'},
                {'id': 'difficulty', 'type': 'rating', 'scale': 5,
                 'text': '執行這個建議的難度如何？'},
                {'id': 'outcome', 'type': 'choice',
                 'options': ['完全達成', '部分達成', '未達成', '尚未執行']},
                {'id': 'open_feedback', 'type': 'text', 'optional': True}
            ]
        },
        
        # 週期性回顧反饋
        'weekly_review': {
            'schedule': 'weekly',
            'questions': [
                {'id': 'overall_satisfaction', 'type': 'rating', 'scale': 10},
                {'id': 'progress_perception', 'type': 'rating', 'scale': 10},
                {'id': 'most_helpful', 'type': 'multi_select'},
                {'id': 'least_helpful', 'type': 'multi_select'},
            ]
        },
        
        # 即時反饋（用戶主動）
        'user_initiated': {
            'channels': ['thumbs_up_down', 'quick_reaction', 'detailed_comment'],
            'context_capture': True  # 自動記錄反饋時的上下文
        }
    }
```

**反饋數據結構**
```python
@dataclass
class ExplicitFeedback:
    feedback_id: str
    user_id: str
    feedback_type: str  # post_intervention, weekly_review, user_initiated
    intervention_id: Optional[str]  # 關聯的建議ID
    timestamp: datetime
    
    # 評分數據
    ratings: Dict[str, Union[int, float]]  # {question_id: score}
    
    # 選擇題數據
    choices: Dict[str, Union[str, List[str]]]
    
    # 開放式反饋
    text_feedback: Optional[str]
    
    # 自動捕獲的上下文
    context: Dict[str, Any] = field(default_factory=dict)
    
    # 情感分析結果（自動計算）
    sentiment_score: Optional[float] = None  # -1.0 to 1.0
```

#### 1.1.2 隱性反饋收集

**行為信號監測**
```python
class ImplicitFeedbackCollector:
    """
    隱性反饋收集器 - 從用戶行為中推斷反饋
    """
    
    BEHAVIORAL_SIGNALS = {
        # 建議採納信號
        'adoption_signals': {
            'immediate_action': {
                'description': '用戶在建議後立即採取相關行動',
                'indicators': [
                    '建議後24小時內記錄相關活動',
                    '使用系統追蹤功能記錄執行',
                    '主動更新進度狀態'
                ],
                'weight': 1.0
            },
            'repeated_action': {
                'description': '用戶重複執行類似建議',
                'indicators': [
                    '連續多日執行同類型建議',
                    '主動請求類似建議',
                    '將建議納入常規習慣'
                ],
                'weight': 1.5
            },
            'goal_achievement': {
                'description': '用戶達成相關目標',
                'indicators': [
                    'KBI指標改善',
                    '用戶主動報告進展',
                    '里程碑達成'
                ],
                'weight': 2.0
            }
        },
        
        # 建議忽視信號
        'ignore_signals': {
            'no_response': {
                'description': '用戶對建議無回應',
                'threshold_hours': 72,
                'weight': -0.3
            },
            'dismissed': {
                'description': '用戶明確忽略或跳過建議',
                'indicators': ['點擊「暫不需要」', '跳過建議卡片'],
                'weight': -0.5
            },
            'repeated_dismissal': {
                'description': '反覆忽略同類型建議',
                'threshold': 3,  # 連續3次
                'weight': -1.0
            }
        },
        
        # 參與度信號
        'engagement_signals': {
            'high_engagement': {
                'indicators': [
                    '頻繁查看進度報告',
                    '主動發起對話',
                    '詳細記錄日誌',
                    '設置提醒和通知'
                ],
                'weight': 1.0
            },
            'low_engagement': {
                'indicators': [
                    '長時間不登錄',
                    '忽略通知',
                    '簡短回應'
                ],
                'weight': -0.5
            }
        }
    }
```

**隱性反饋推斷算法**
```python
class ImplicitFeedbackInference:
    """
    基於行為數據推斷用戶對建議的態度
    """
    
    def infer_feedback(
        self,
        intervention: Intervention,
        user_behavior: UserBehaviorLog,
        time_window_days: int = 7
    ) -> ImplicitFeedback:
        """
        推斷用戶對特定建議的隱性反饋
        """
        signals = []
        confidence = 0.0
        
        # 1. 檢查建議採納信號
        adoption_score = self._calculate_adoption_score(
            intervention, user_behavior, time_window_days
        )
        if adoption_score > 0.7:
            signals.append(('high_adoption', adoption_score))
            confidence += 0.3
        elif adoption_score < 0.3:
            signals.append(('low_adoption', adoption_score))
            confidence += 0.2
            
        # 2. 檢查參與度變化
        engagement_delta = self._calculate_engagement_delta(
            intervention.timestamp, time_window_days
        )
        if engagement_delta > 0.2:
            signals.append(('increased_engagement', engagement_delta))
            confidence += 0.25
        elif engagement_delta < -0.2:
            signals.append(('decreased_engagement', engagement_delta))
            confidence += 0.25
            
        # 3. 檢查目標進展
        progress_delta = self._calculate_progress_delta(
            intervention.related_goals, time_window_days
        )
        if progress_delta > 0:
            signals.append(('positive_progress', progress_delta))
            confidence += 0.3
        elif progress_delta < 0:
            signals.append(('negative_progress', progress_delta))
            confidence += 0.2
            
        # 4. 計算綜合隱性反饋分數
        implicit_score = self._aggregate_signals(signals)
        
        return ImplicitFeedback(
            intervention_id=intervention.id,
            inferred_score=implicit_score,
            confidence=min(confidence, 1.0),
            signals=signals,
            inference_method='behavioral_analysis'
        )
        
    def _calculate_adoption_score(
        self, 
        intervention: Intervention,
        behavior: UserBehaviorLog,
        days: int
    ) -> float:
        """
        計算建議採納分數
        """
        # 獲取建議後的行為數據
        post_intervention_actions = behavior.get_actions_after(
            intervention.timestamp,
            action_types=intervention.related_action_types
        )
        
        if not post_intervention_actions:
            return 0.0
            
        # 計算採納指標
        metrics = {
            'action_count': len(post_intervention_actions),
            'action_frequency': len(post_intervention_actions) / days,
            'consistency': self._calculate_consistency(post_intervention_actions),
            'intensity': self._calculate_intensity(post_intervention_actions),
        }
        
        # 加權計算採納分數
        weights = {'action_count': 0.2, 'action_frequency': 0.3, 
                   'consistency': 0.3, 'intensity': 0.2}
        
        # 標準化並加權
        adoption_score = sum(
            self._normalize(metrics[k], intervention.expected_range[k]) * weights[k]
            for k in weights.keys()
        )
        
        return min(max(adoption_score, 0.0), 1.0)
```

### 1.2 建議結果追蹤機制

#### 1.2.1 結果追蹤框架

```python
class InterventionOutcomeTracker:
    """
    建議結果追蹤器 - 追蹤每個建議的實際效果
    """
    
    OUTCOME_DIMENSIONS = {
        # 即時結果
        'immediate': {
            'user_response_time': '用戶回應時間（小時）',
            'initial_engagement': '初始參與度評分',
            'clarification_requests': '澄清請求次數'
        },
        
        # 短期結果（1-7天）
        'short_term': {
            'adoption_rate': '採納率',
            'completion_rate': '完成率',
            'satisfaction_score': '滿意度評分',
            'difficulty_perception': '感知難度'
        },
        
        # 中期結果（1-4週）
        'medium_term': {
            'habit_formation': '習慣形成指標',
            'kbi_changes': 'KBI指標變化',
            'behavior_consistency': '行為一致性',
            'goal_progress': '目標進展百分比'
        },
        
        # 長期結果（1-6個月）
        'long_term': {
            'sustained_behavior': '行為持續性',
            'goal_achievement': '目標達成率',
            'overall_wellbeing': '整體幸福感變化',
            'system_trust': '系統信任度'
        }
    }
    
    def track_outcome(
        self,
        intervention_id: str,
        outcome_type: str,
        measurement_point: datetime
    ) -> InterventionOutcome:
        """
        追蹤特定建議在特定時間點的結果
        """
        intervention = self.get_intervention(intervention_id)
        
        # 收集該時間維度的所有指標
        metrics = {}
        
        for metric_name, metric_config in self.OUTCOME_DIMENSIONS[outcome_type].items():
            metric_value = self._collect_metric(
                intervention, metric_name, measurement_point
            )
            metrics[metric_name] = metric_value
            
        # 計算綜合結果分數
        outcome_score = self._calculate_outcome_score(metrics, outcome_type)
        
        return InterventionOutcome(
            intervention_id=intervention_id,
            outcome_type=outcome_type,
            measurement_point=measurement_point,
            metrics=metrics,
            overall_score=outcome_score,
            confidence=self._calculate_confidence(metrics)
        )
```

#### 1.2.2 因果推斷引擎

```python
class CausalInferenceEngine:
    """
    因果推斷引擎 - 區分建議效果與其他因素
    """
    
    def estimate_causal_effect(
        self,
        intervention: Intervention,
        target_outcome: str,
        estimation_method: str = 'synthetic_control'
    ) -> CausalEffectEstimate:
        """
        估計建議對結果的因果效應
        
        方法選項：
        - synthetic_control: 合成控制法
        - difference_in_differences: 雙重差分法
        - propensity_matching: 傾向得分匹配
        - regression_discontinuity: 斷點回歸
        """
        
        if estimation_method == 'synthetic_control':
            return self._synthetic_control_method(intervention, target_outcome)
        elif estimation_method == 'difference_in_differences':
            return self._did_method(intervention, target_outcome)
        elif estimation_method == 'propensity_matching':
            return self._propensity_matching(intervention, target_outcome)
        else:
            raise ValueError(f"Unknown method: {estimation_method}")
            
    def _synthetic_control_method(
        self,
        intervention: Intervention,
        target_outcome: str
    ) -> CausalEffectEstimate:
        """
        合成控制法 - 構建「虛擬對照組」
        """
        # 1. 找到相似用戶（在干預前具有相似特徵和行為模式）
        similar_users = self._find_similar_users(
            intervention.user_id,
            intervention.timestamp,
            n_candidates=50
        )
        
        # 2. 排除同時接受類似干預的用戶
        control_pool = [
            u for u in similar_users 
            if not self._received_similar_intervention(u, intervention)
        ]
        
        # 3. 計算合成控制權重
        # 目標：最小化干預前結果變量的差異
        pre_intervention_period = (
            intervention.timestamp - timedelta(days=30),
            intervention.timestamp
        )
        
        weights = self._optimize_synthetic_weights(
            target_user=intervention.user_id,
            control_pool=control_pool,
            outcome_variable=target_outcome,
            pre_period=pre_intervention_period
        )
        
        # 4. 構建合成控制組
        synthetic_control = self._build_synthetic_control(
            control_pool, weights
        )
        
        # 5. 計算干預效應
        post_period = (
            intervention.timestamp,
            intervention.timestamp + timedelta(days=intervention.follow_up_days)
        )
        
        actual_outcome = self._get_outcome_trajectory(
            intervention.user_id, target_outcome, post_period
        )
        synthetic_outcome = self._get_outcome_trajectory(
            synthetic_control, target_outcome, post_period
        )
        
        treatment_effect = actual_outcome - synthetic_outcome
        
        # 6. 計算統計顯著性
        significance = self._calculate_significance(
            treatment_effect, intervention, control_pool
        )
        
        return CausalEffectEstimate(
            effect_size=treatment_effect.mean(),
            confidence_interval=self._compute_ci(treatment_effect),
            p_value=significance,
            method='synthetic_control',
            assumptions_validated=self._validate_assumptions(
                intervention, synthetic_control
            )
        )
```

### 1.3 A/B測試框架設計

```python
class ABTestingFramework:
    """
    A/B測試框架 - 系統化測試不同策略的效果
    """
    
    def __init__(self):
        self.experiment_registry = ExperimentRegistry()
        self.randomization_engine = StratifiedRandomization()
        self.analysis_engine = ExperimentAnalysis()
        
    def create_experiment(
        self,
        experiment_name: str,
        hypothesis: str,
        variants: List[VariantConfig],
        target_metric: str,
        sample_size: int,
        duration_days: int,
        stratification_vars: List[str]
    ) -> Experiment:
        """
        創建新的A/B測試實驗
        """
        experiment_id = generate_uuid()
        
        # 計算所需樣本量（統計功效分析）
        required_sample = self._calculate_sample_size(
            baseline_rate=self._get_baseline_rate(target_metric),
            expected_lift=self._parse_hypothesis(hypothesis),
            power=0.8,
            alpha=0.05
        )
        
        return Experiment(
            id=experiment_id,
            name=experiment_name,
            hypothesis=hypothesis,
            variants=variants,
            target_metric=target_metric,
            planned_sample_size=max(sample_size, required_sample),
            duration_days=duration_days,
            stratification_vars=stratification_vars,
            status='design'
        )
        
    def assign_user(
        self,
        user_id: str,
        experiment_id: str
    ) -> str:
        """
        將用戶分配到實驗組別（分層隨機化）
        """
        experiment = self.experiment_registry.get(experiment_id)
        
        # 獲取用戶的分層特徵
        user_strata = self._get_user_strata(
            user_id, 
            experiment.stratification_vars
        )
        
        # 檢查該分層的分配比例
        current_allocation = self._get_strata_allocation(
            experiment_id, 
            user_strata
        )
        
        # 使用加權隨機分配，確保各分層內平衡
        variant = self.randomization_engine.assign(
            user_id=user_id,
            strata=user_strata,
            variants=experiment.variants,
            current_allocation=current_allocation,
            target_allocation={v.id: v.allocation_ratio 
                             for v in experiment.variants}
        )
        
        # 記錄分配
        self._record_assignment(user_id, experiment_id, variant, user_strata)
        
        return variant
        
    def analyze_experiment(
        self,
        experiment_id: str,
        analysis_type: str = 'frequentist'
    ) -> ExperimentResult:
        """
        分析實驗結果
        """
        experiment = self.experiment_registry.get(experiment_id)
        data = self._collect_experiment_data(experiment_id)
        
        if analysis_type == 'frequentist':
            return self._frequentist_analysis(data, experiment)
        elif analysis_type == 'bayesian':
            return self._bayesian_analysis(data, experiment)
        elif analysis_type == 'sequential':
            return self._sequential_analysis(data, experiment)
        else:
            raise ValueError(f"Unknown analysis type: {analysis_type}")
            
    def _bayesian_analysis(
        self,
        data: ExperimentData,
        experiment: Experiment
    ) -> ExperimentResult:
        """
        貝葉斯分析 - 提供機率化結論
        """
        import pymc as pm
        
        # 準備數據
        variant_data = {
            variant.id: data.get_variant_outcomes(variant.id)
            for variant in experiment.variants
        }
        
        # 構建貝葉斯模型
        with pm.Model() as model:
            # 先驗分佈
            baseline_prior = pm.Beta(
                'baseline', 
                alpha=1, 
                beta=1
            )
            
            # 各變體的效果
            variant_effects = {}
            for variant_id, outcomes in variant_data.items():
                if variant_id == 'control':
                    variant_effects[variant_id] = baseline_prior
                else:
                    effect = pm.Normal(
                        f'effect_{variant_id}',
                        mu=0,
                        sigma=0.1
                    )
                    variant_effects[variant_id] = pm.Deterministic(
                        f'rate_{variant_id}',
                        baseline_prior + effect
                    )
                    
            # 似然函數
            for variant_id, outcomes in variant_data.items():
                pm.Binomial(
                    f'obs_{variant_id}',
                    n=len(outcomes),
                    p=variant_effects[variant_id],
                    observed=sum(outcomes)
                )
                
            # 採樣
            trace = pm.sample(2000, tune=1000)
            
        # 計算後驗機率
        results = {}
        control_samples = trace.posterior['baseline'].values.flatten()
        
        for variant in experiment.variants:
            if variant.id != 'control':
                variant_samples = trace.posterior[f'rate_{variant.id}'].values.flatten()
                
                # 計算變體優於對照組的機率
                prob_better = (variant_samples > control_samples).mean()
                
                # 計算期望提升
                expected_lift = (variant_samples - control_samples).mean()
                
                # 95% 可信區間
                ci_lower = np.percentile(variant_samples - control_samples, 2.5)
                ci_upper = np.percentile(variant_samples - control_samples, 97.5)
                
                results[variant.id] = {
                    'prob_better_than_control': prob_better,
                    'expected_lift': expected_lift,
                    'credible_interval': (ci_lower, ci_upper),
                    'expected_loss': self._calculate_expected_loss(
                        variant_samples, control_samples
                    )
                }
                
        return ExperimentResult(
            experiment_id=experiment.id,
            analysis_type='bayesian',
            variant_results=results,
            recommendation=self._generate_recommendation(results),
            uncertainty_quantified=True
        )
```

### 1.4 反饋影響Agent行為的機制

```python
class FeedbackIntegrationEngine:
    """
    反饋整合引擎 - 將反饋轉化為Agent行為改進
    """
    
    def __init__(self):
        self.feedback_processor = FeedbackProcessor()
        self.learning_engine = AgentLearningEngine()
        self.update_scheduler = UpdateScheduler()
        
    def process_feedback_batch(
        self,
        batch_size: int = 100,
        time_window_hours: int = 24
    ) -> FeedbackProcessingResult:
        """
        批量處理反饋數據，生成改進建議
        """
        # 1. 收集反饋
        feedback_batch = self.feedback_processor.collect_batch(
            batch_size, time_window_hours
        )
        
        # 2. 分類反饋
        categorized = self._categorize_feedback(feedback_batch)
        
        # 3. 識別模式
        patterns = self._identify_patterns(categorized)
        
        # 4. 生成改進建議
        improvements = self._generate_improvements(patterns)
        
        # 5. 排程更新
        update_plan = self.update_scheduler.schedule(improvements)
        
        return FeedbackProcessingResult(
            processed_count=len(feedback_batch),
            patterns_identified=patterns,
            improvements_suggested=improvements,
            update_schedule=update_plan
        )
        
    def _identify_patterns(
        self,
        categorized_feedback: Dict[str, List[Feedback]]
    ) -> List[FeedbackPattern]:
        """
        識別反饋中的模式
        """
        patterns = []
        
        # 模式1: 特定類型建議的系統性問題
        for intervention_type, feedbacks in categorized_feedback.items():
            satisfaction_scores = [f.satisfaction for f in feedbacks]
            avg_satisfaction = np.mean(satisfaction_scores)
            
            if avg_satisfaction < 3.0:  # 5分制
                patterns.append(FeedbackPattern(
                    pattern_type='systematic_underperformance',
                    target=intervention_type,
                    severity='high',
                    evidence={
                        'sample_size': len(feedbacks),
                        'avg_satisfaction': avg_satisfaction,
                        'common_complaints': self._extract_common_themes(
                            [f.text for f in feedbacks if f.text]
                        )
                    },
                    suggested_action='review_intervention_type'
                ))
                
        # 模式2: 用戶群體差異
        user_segments = self._segment_users_by_feedback(categorized_feedback)
        for segment, metrics in user_segments.items():
            if metrics['satisfaction_variance'] > 2.0:
                patterns.append(FeedbackPattern(
                    pattern_type='segment_specific_issue',
                    target=segment,
                    severity='medium',
                    evidence={
                        'segment_size': metrics['size'],
                        'satisfaction_variance': metrics['satisfaction_variance'],
                        'distinctive_features': metrics['distinctive_features']
                    },
                    suggested_action='develop_segment_specific_strategy'
                ))
                
        # 模式3: 時間趨勢
        temporal_trends = self._analyze_temporal_trends(categorized_feedback)
        for metric, trend in temporal_trends.items():
            if trend['direction'] == 'declining' and trend['significance'] < 0.05:
                patterns.append(FeedbackPattern(
                    pattern_type='deteriorating_performance',
                    target=metric,
                    severity='high',
                    evidence={
                        'trend_slope': trend['slope'],
                        'p_value': trend['significance'],
                        'time_period': trend['period']
                    },
                    suggested_action='urgent_review_required'
                ))
                
        return patterns
        
    def apply_feedback_to_agent(
        self,
        agent_id: str,
        feedback_insights: List[Insight]
    ) -> AgentUpdate:
        """
        將反饋洞察應用到特定Agent
        """
        agent = self.get_agent(agent_id)
        
        updates = []
        
        for insight in feedback_insights:
            if insight.target_agent == agent_id:
                # 根據洞察類型應用不同更新
                if insight.type == 'prompt_improvement':
                    update = self._update_agent_prompt(agent, insight)
                    updates.append(update)
                    
                elif insight.type == 'parameter_tuning':
                    update = self._tune_agent_parameters(agent, insight)
                    updates.append(update)
                    
                elif insight.type == 'knowledge_update':
                    update = self._update_agent_knowledge(agent, insight)
                    updates.append(update)
                    
                elif insight.type == 'workflow_adjustment':
                    update = self._adjust_agent_workflow(agent, insight)
                    updates.append(update)
                    
        # 驗證更新
        validated_updates = self._validate_updates(updates)
        
        # 應用更新
        for update in validated_updates:
            self._apply_update(agent, update)
            
        return AgentUpdate(
            agent_id=agent_id,
            updates_applied=validated_updates,
            version_bump=self._determine_version_bump(validated_updates),
            rollback_plan=self._create_rollback_plan(validated_updates)
        )
```

---

## 2. 個人化模型進化

### 2.1 用戶畫像的持續更新機制

#### 2.1.1 動態用戶畫像架構

```python
@dataclass
class DynamicUserProfile:
    """
    動態用戶畫像 - 持續更新的用戶理解模型
    """
    user_id: str
    created_at: datetime
    last_updated: datetime
    version: int
    
    # 核心特徵（相對穩定）
    core_traits: CoreTraits
    
    # 動態特徵（持續演變）
    dynamic_traits: DynamicTraits
    
    # 情境特徵（隨時間和環境變化）
    contextual_traits: ContextualTraits
    
    # 學習歷史
    learning_history: LearningHistory
    
    # 置信度和不確定性
    confidence_scores: Dict[str, float]
    uncertainty_estimates: Dict[str, float]

@dataclass
class CoreTraits:
    """
    核心特徵 - 相對穩定的用戶屬性
    """
    # 人格特質（基於持續觀察）
    personality_profile: Dict[str, float]
    # 價值觀和優先級
    value_hierarchy: List[ValueItem]
    # 長期目標
    long_term_goals: List[Goal]
    # 學習風格
    learning_style: LearningStyleProfile
    # 決策模式
    decision_making_pattern: DecisionPattern
    # 更新頻率：每月
    update_frequency: str = 'monthly'

@dataclass
class DynamicTraits:
    """
    動態特徵 - 持續演變的用戶屬性
    """
    # 當前狀態
    current_state: UserState
    # 短期目標和優先級
    short_term_priorities: List[Priority]
    # 近期行為模式
    recent_behavior_patterns: List[BehaviorPattern]
    # 情緒趨勢
    emotional_trends: EmotionalTrends
    # 習慣形成狀態
    habit_status: Dict[str, HabitStatus]
    # 更新頻率：每日
    update_frequency: str = 'daily'

@dataclass
class ContextualTraits:
    """
    情境特徵 - 隨時間和環境變化的屬性
    """
    # 當前情境
    current_context: CurrentContext
    # 生活階段
    life_stage: LifeStage
    # 外部環境因素
    external_factors: ExternalFactors
    # 社交情境
    social_context: SocialContext
    # 更新頻率：實時
    update_frequency: str = 'realtime'
```

#### 2.1.2 用戶畫像更新引擎

```python
class UserProfileUpdateEngine:
    """
    用戶畫像更新引擎 - 持續更新用戶理解
    """
    
    def __init__(self):
        self.core_updater = CoreTraitsUpdater()
        self.dynamic_updater = DynamicTraitsUpdater()
        self.contextual_updater = ContextualTraitsUpdater()
        self.confidence_calculator = ConfidenceCalculator()
        
    def update_profile(
        self,
        user_id: str,
        new_data: UserInteractionData,
        update_type: str = 'incremental'
    ) -> ProfileUpdateResult:
        """
        更新用戶畫像
        """
        profile = self.get_current_profile(user_id)
        
        # 根據更新類型執行不同更新策略
        if update_type == 'incremental':
            # 增量更新 - 基於新數據微調
            updated_profile = self._incremental_update(profile, new_data)
            
        elif update_type == 'periodic':
            # 週期性更新 - 基於時間窗口的數據重新計算
            updated_profile = self._periodic_update(profile, new_data)
            
        elif update_type == 'triggered':
            # 觸發式更新 - 基於特定事件
            updated_profile = self._triggered_update(profile, new_data)
            
        else:
            raise ValueError(f"Unknown update type: {update_type}")
            
        # 計算更新後的置信度
        updated_profile.confidence_scores = self.confidence_calculator.calculate(
            updated_profile
        )
        
        # 檢測重大變化
        significant_changes = self._detect_significant_changes(
            profile, updated_profile
        )
        
        # 保存更新
        self._save_profile(updated_profile)
        
        return ProfileUpdateResult(
            user_id=user_id,
            previous_version=profile.version,
            new_version=updated_profile.version,
            changes_made=significant_changes,
            confidence_scores=updated_profile.confidence_scores,
            update_timestamp=datetime.now()
        )
        
    def _incremental_update(
        self,
        profile: DynamicUserProfile,
        new_data: UserInteractionData
    ) -> DynamicUserProfile:
        """
        增量更新 - 使用貝葉斯更新機制
        """
        # 更新動態特徵（最頻繁）
        profile.dynamic_traits = self.dynamic_updater.update(
            profile.dynamic_traits,
            new_data,
            learning_rate=0.1  # 新數據權重
        )
        
        # 檢查是否需要更新核心特徵
        if self._should_update_core_traits(profile):
            profile.core_traits = self.core_updater.update(
                profile.core_traits,
                self._get_accumulated_evidence(profile, days=30)
            )
            
        # 更新情境特徵
        profile.contextual_traits = self.contextual_updater.update(
            profile.contextual_traits,
            new_data
        )
        
        profile.last_updated = datetime.now()
        profile.version += 1
        
        return profile
        
    def _should_update_core_traits(self, profile: DynamicUserProfile) -> bool:
        """
        判斷是否需要更新核心特徵
        """
        # 1. 時間條件：距上次更新超過30天
        time_since_update = datetime.now() - profile.core_traits.last_updated
        if time_since_update.days >= 30:
            return True
            
        # 2. 數據累積條件：累積了足夠的新證據
        new_evidence_count = self._count_new_evidence(profile, days=30)
        if new_evidence_count >= 100:  # 至少100個新數據點
            return True
            
        # 3. 異常檢測：發現與核心特徵不一致的行為
        inconsistency_score = self._calculate_inconsistency(profile)
        if inconsistency_score > 0.7:  # 高度不一致
            return True
            
        return False
```

### 2.2 行為模式的自動發現算法

#### 2.2.1 多層次行為模式識別

```python
class BehaviorPatternDiscovery:
    """
    行為模式發現引擎 - 自動識別用戶行為模式
    """
    
    def __init__(self):
        self.sequence_miner = SequencePatternMiner()
        self.temporal_miner = TemporalPatternMiner()
        self.causal_miner = CausalPatternMiner()
        self.clustering_engine = BehaviorClustering()
        
    def discover_patterns(
        self,
        user_id: str,
        time_range: Tuple[datetime, datetime],
        pattern_types: List[str] = None
    ) -> List[BehaviorPattern]:
        """
        發現用戶的行為模式
        """
        if pattern_types is None:
            pattern_types = ['sequential', 'temporal', 'causal', 'contextual']
            
        # 獲取用戶行為數據
        behavior_data = self._load_behavior_data(user_id, time_range)
        
        patterns = []
        
        # 1. 序列模式發現
        if 'sequential' in pattern_types:
            sequential_patterns = self.sequence_miner.mine(
                behavior_data,
                min_support=0.1,
                min_confidence=0.7
            )
            patterns.extend(sequential_patterns)
            
        # 2. 時間模式發現
        if 'temporal' in pattern_types:
            temporal_patterns = self.temporal_miner.mine(
                behavior_data,
                time_granularity='hour'
            )
            patterns.extend(temporal_patterns)
            
        # 3. 因果模式發現
        if 'causal' in pattern_types:
            causal_patterns = self.causal_miner.discover(
                behavior_data,
                significance_threshold=0.05
            )
            patterns.extend(causal_patterns)
            
        # 4. 情境模式發現
        if 'contextual' in pattern_types:
            contextual_patterns = self._discover_contextual_patterns(
                behavior_data
            )
            patterns.extend(contextual_patterns)
            
        # 過濾和排序
        filtered_patterns = self._filter_patterns(patterns)
        ranked_patterns = self._rank_patterns(filtered_patterns)
        
        return ranked_patterns
        
    class SequencePatternMiner:
        """
        序列模式挖掘 - 發現行為序列規律
        """
        
        def mine(
            self,
            behavior_data: List[BehaviorEvent],
            min_support: float = 0.1,
            min_confidence: float = 0.7,
            max_pattern_length: int = 5
        ) -> List[SequentialPattern]:
            """
            使用PrefixSpan算法挖掘序列模式
            """
            # 將行為數據轉換為序列
            sequences = self._convert_to_sequences(behavior_data)
            
            # 運行PrefixSpan算法
            frequent_sequences = self._prefixspan(
                sequences,
                min_support=min_support,
                max_length=max_pattern_length
            )
            
            patterns = []
            for seq, support in frequent_sequences:
                # 計算置信度
                confidence = self._calculate_sequence_confidence(
                    seq, sequences
                )
                
                if confidence >= min_confidence:
                    pattern = SequentialPattern(
                        sequence=seq,
                        support=support,
                        confidence=confidence,
                        frequency=self._calculate_frequency(seq, behavior_data),
                        context=self._extract_context(seq, behavior_data)
                    )
                    patterns.append(pattern)
                    
            return patterns
            
        def _prefixspan(
            self,
            sequences: List[List[str]],
            min_support: float,
            max_length: int
        ) -> List[Tuple[List[str], float]]:
            """
            PrefixSpan算法實現
            """
            results = []
            
            def project_database(prefix, sequences):
                """構建投影數據庫"""
                projected = []
                for seq in sequences:
                    if prefix in seq:
                        idx = seq.index(prefix[-1]) if prefix else -1
                        if idx >= 0 and idx < len(seq) - 1:
                            projected.append(seq[idx+1:])
                return projected
                
            def mine_recursive(prefix, projected_db, length):
                if length >= max_length:
                    return
                    
                # 統計頻繁項
                item_counts = defaultdict(int)
                for seq in projected_db:
                    seen = set()
                    for item in seq:
                        if item not in seen:
                            item_counts[item] += 1
                            seen.add(item)
                            
                total = len(sequences)
                frequent_items = [
                    (item, count/total) 
                    for item, count in item_counts.items()
                    if count/total >= min_support
                ]
                
                for item, support in frequent_items:
                    new_prefix = prefix + [item]
                    results.append((new_prefix, support))
                    
                    # 遞歸挖掘
                    new_projected = project_database(new_prefix, projected_db)
                    mine_recursive(new_prefix, new_projected, length + 1)
                    
            mine_recursive([], sequences, 0)
            return results
            
    class TemporalPatternMiner:
        """
        時間模式挖掘 - 發現行為的時間規律
        """
        
        def mine(
            self,
            behavior_data: List[BehaviorEvent],
            time_granularity: str = 'hour'
        ) -> List[TemporalPattern]:
            """
            發現時間相關的行為模式
            """
            patterns = []
            
            # 1. 日週期模式
            daily_patterns = self._discover_daily_patterns(behavior_data)
            patterns.extend(daily_patterns)
            
            # 2. 週週期模式
            weekly_patterns = self._discover_weekly_patterns(behavior_data)
            patterns.extend(weekly_patterns)
            
            # 3. 自定義週期（使用傅立葉變換）
            custom_periods = self._discover_custom_periods(behavior_data)
            patterns.extend(custom_periods)
            
            # 4. 異常時間模式
            anomaly_patterns = self._discover_temporal_anomalies(behavior_data)
            patterns.extend(anomaly_patterns)
            
            return patterns
            
        def _discover_daily_patterns(
            self,
            behavior_data: List[BehaviorEvent]
        ) -> List[TemporalPattern]:
            """
            發現日週期行為模式
            """
            # 按小時聚合行為
            hourly_distribution = defaultdict(lambda: defaultdict(int))
            
            for event in behavior_data:
                hour = event.timestamp.hour
                behavior_type = event.behavior_type
                hourly_distribution[behavior_type][hour] += 1
                
            patterns = []
            
            for behavior_type, hourly_counts in hourly_distribution.items():
                # 使用核密度估計找到高峰時段
                hours = list(range(24))
                counts = [hourly_counts[h] for h in hours]
                
                # 平滑處理
                smoothed = gaussian_filter1d(counts, sigma=1)
                
                # 找到峰值
                peaks, properties = find_peaks(
                    smoothed, 
                    height=np.mean(smoothed),
                    distance=2
                )
                
                if len(peaks) > 0:
                    # 計算每個高峰的顯著性
                    for peak in peaks:
                        peak_hour = hours[peak]
                        significance = smoothed[peak] / np.mean(smoothed)
                        
                        if significance > 1.5:  # 顯著高於平均
                            pattern = TemporalPattern(
                                pattern_type='daily_peak',
                                behavior_type=behavior_type,
                                time_specification={'hour': peak_hour},
                                strength=significance,
                                confidence=self._calculate_temporal_confidence(
                                    behavior_type, peak_hour, behavior_data
                                )
                            )
                            patterns.append(pattern)
                            
            return patterns
            
        def _discover_custom_periods(
            self,
            behavior_data: List[BehaviorEvent]
        ) -> List[TemporalPattern]:
            """
            使用傅立葉變換發現自定義週期
            """
            patterns = []
            
            # 構建時間序列
            behavior_type = behavior_data[0].behavior_type
            timestamps = [e.timestamp for e in behavior_data 
                         if e.behavior_type == behavior_type]
            
            if len(timestamps) < 10:
                return patterns
                
            # 創建時間序列（每小時的發生次數）
            time_range = (min(timestamps), max(timestamps))
            hours = int((time_range[1] - time_range[0]).total_seconds() / 3600) + 1
            
            ts = np.zeros(hours)
            for t in timestamps:
                hour_idx = int((t - time_range[0]).total_seconds() / 3600)
                if 0 <= hour_idx < hours:
                    ts[hour_idx] += 1
                    
            # 傅立葉變換
            fft_result = np.fft.fft(ts)
            frequencies = np.fft.fftfreq(len(ts), d=1)  # 每小時一個點
            
            # 找到主要頻率成分
            power = np.abs(fft_result) ** 2
            positive_freq_idx = frequencies > 0
            
            # 找到功率譜峰值
            peaks, _ = find_peaks(power[positive_freq_idx], height=np.percentile(power, 90))
            
            for peak in peaks:
                period_hours = int(1 / frequencies[positive_freq_idx][peak])
                
                # 只考慮合理的週期（2小時到30天）
                if 2 <= period_hours <= 24 * 30:
                    pattern = TemporalPattern(
                        pattern_type='custom_periodicity',
                        behavior_type=behavior_type,
                        time_specification={'period_hours': period_hours},
                        strength=power[positive_freq_idx][peak] / np.mean(power),
                        confidence=self._validate_periodicity(
                            behavior_data, period_hours
                        )
                    )
                    patterns.append(pattern)
                    
            return patterns
```

#### 2.2.2 模式驗證與演化追蹤

```python
class PatternEvolutionTracker:
    """
    模式演化追蹤器 - 追蹤行為模式的變化
    """
    
    def __init__(self):
        self.pattern_history = PatternHistoryStore()
        self.change_detector = PatternChangeDetector()
        
    def track_pattern_evolution(
        self,
        user_id: str,
        pattern: BehaviorPattern,
        observation_window: int = 30  # 天
    ) -> PatternEvolutionReport:
        """
        追蹤特定模式的演化
        """
        # 獲取模式的歷史記錄
        history = self.pattern_history.get_pattern_history(
            user_id, pattern.pattern_id
        )
        
        if not history:
            # 新模式
            return PatternEvolutionReport(
                pattern_id=pattern.pattern_id,
                status='new_pattern',
                stability_score=None,
                trend=None,
                recommendations=['continue_monitoring']
            )
            
        # 分析模式的變化趨勢
        trend_analysis = self._analyze_trend(history)
        
        # 檢測重大變化
        change_points = self.change_detector.detect_changes(history)
        
        # 計算穩定性分數
        stability = self._calculate_stability(history, change_points)
        
        # 預測未來演化
        prediction = self._predict_evolution(history, trend_analysis)
        
        return PatternEvolutionReport(
            pattern_id=pattern.pattern_id,
            status=self._determine_status(stability, change_points),
            stability_score=stability,
            trend=trend_analysis,
            change_points=change_points,
            prediction=prediction,
            recommendations=self._generate_recommendations(
                stability, trend_analysis, prediction
            )
        )
        
    def _analyze_trend(
        self,
        history: List[PatternObservation]
    ) -> TrendAnalysis:
        """
        分析模式的趨勢
        """
        # 提取時間序列
        timestamps = [h.timestamp for h in history]
        strength_values = [h.strength for h in history]
        
        # 線性回歸分析趨勢
        x = np.arange(len(strength_values))
        slope, intercept, r_value, p_value, std_err = linregress(
            x, strength_values
        )
        
        # 判斷趨勢方向
        if p_value > 0.05:
            direction = 'stable'
        elif slope > 0.01:
            direction = 'strengthening'
        elif slope < -0.01:
            direction = 'weakening'
        else:
            direction = 'stable'
            
        # 計算變化率
        if len(strength_values) > 1:
            change_rate = (strength_values[-1] - strength_values[0]) / len(strength_values)
        else:
            change_rate = 0
            
        return TrendAnalysis(
            direction=direction,
            slope=slope,
            r_squared=r_value ** 2,
            p_value=p_value,
            change_rate=change_rate,
            significance='significant' if p_value < 0.05 else 'not_significant'
        )
```

### 2.3 偏好學習與適應策略

```python
class PreferenceLearningEngine:
    """
    偏好學習引擎 - 學習和適應用戶偏好
    """
    
    def __init__(self):
        self.explicit_preference_learner = ExplicitPreferenceLearner()
        self.implicit_preference_learner = ImplicitPreferenceLearner()
        self.preference_fusion = PreferenceFusion()
        self.adaptation_engine = PreferenceAdaptationEngine()
        
    def learn_preferences(
        self,
        user_id: str,
        preference_domain: str
    ) -> PreferenceProfile:
        """
        學習用戶在特定領域的偏好
        """
        # 1. 從顯性反饋學習
        explicit_prefs = self.explicit_preference_learner.learn(
            user_id, preference_domain
        )
        
        # 2. 從隱性行為學習
        implicit_prefs = self.implicit_preference_learner.learn(
            user_id, preference_domain
        )
        
        # 3. 融合兩種來源
        fused_prefs = self.preference_fusion.fuse(
            explicit_prefs, 
            implicit_prefs,
            fusion_strategy='weighted_average',
            weights={'explicit': 0.7, 'implicit': 0.3}
        )
        
        # 4. 計算置信度
        fused_prefs.confidence = self._calculate_preference_confidence(
            explicit_prefs, implicit_prefs
        )
        
        return fused_prefs
        
    class ImplicitPreferenceLearner:
        """
        隱性偏好學習器 - 從行為中推斷偏好
        """
        
        def learn(
            self,
            user_id: str,
            preference_domain: str
        ) -> ImplicitPreferenceProfile:
            """
            從用戶行為學習隱性偏好
            """
            # 獲取用戶行為數據
            behavior_data = self._load_behavior_data(user_id, preference_domain)
            
            preferences = {}
            
            # 1. 選擇偏好（Choice-Based Preference）
            choice_prefs = self._infer_from_choices(behavior_data)
            preferences['choice_based'] = choice_prefs
            
            # 2. 時間偏好（Temporal Preference）
            temporal_prefs = self._infer_temporal_preferences(behavior_data)
            preferences['temporal'] = temporal_prefs
            
            # 3. 強度偏好（Intensity Preference）
            intensity_prefs = self._infer_intensity_preferences(behavior_data)
            preferences['intensity'] = intensity_prefs
            
            # 4. 組合偏好（Combination Preference）
            combination_prefs = self._infer_combination_preferences(behavior_data)
            preferences['combination'] = combination_prefs
            
            return ImplicitPreferenceProfile(
                domain=preference_domain,
                preferences=preferences,
                inference_confidence=self._calculate_inference_confidence(
                    behavior_data
                ),
                sample_size=len(behavior_data)
            )
            
        def _infer_from_choices(
            self,
            behavior_data: List[BehaviorEvent]
        ) -> Dict[str, float]:
            """
            從選擇行為推斷偏好
            
            使用Bradley-Terry模型估計選項間的偏好強度
            """
            # 構建選擇對比數據
            choice_pairs = []
            
            for event in behavior_data:
                if event.event_type == 'choice_made':
                    choice_pairs.append({
                        'chosen': event.chosen_option,
                        'available': event.available_options,
                        'context': event.context
                    })
                    
            # Bradley-Terry模型參數估計
            options = set()
            for pair in choice_pairs:
                options.update(pair['available'])
                
            options = sorted(list(options))
            n_options = len(options)
            
            # 構建勝率矩陣
            win_matrix = np.zeros((n_options, n_options))
            
            for pair in choice_pairs:
                chosen_idx = options.index(pair['chosen'])
                for option in pair['available']:
                    if option != pair['chosen']:
                        other_idx = options.index(option)
                        win_matrix[chosen_idx][other_idx] += 1
                        
            # 迭代估計偏好參數
            preferences = np.ones(n_options) / n_options
            
            for _ in range(100):  # 迭代優化
                new_preferences = np.zeros(n_options)
                
                for i in range(n_options):
                    numerator = np.sum(win_matrix[i])
                    denominator = 0
                    
                    for j in range(n_options):
                        if i != j:
                            denominator += (win_matrix[i][j] + win_matrix[j][i]) / (
                                preferences[i] + preferences[j]
                            )
                            
                    new_preferences[i] = numerator / max(denominator, 1e-10)
                    
                preferences = new_preferences / np.sum(new_preferences)
                
            return {options[i]: preferences[i] for i in range(n_options)}
            
    def adapt_to_preference_change(
        self,
        user_id: str,
        preference_domain: str,
        change_signal: PreferenceChangeSignal
    ) -> AdaptationResult:
        """
        適應用戶偏好的變化
        """
        # 1. 檢測偏好變化類型
        change_type = self._classify_preference_change(change_signal)
        
        # 2. 根據變化類型選擇適應策略
        if change_type == 'gradual_shift':
            # 漸進變化 - 平滑過渡
            adaptation = self._gradual_adaptation(user_id, preference_domain, change_signal)
            
        elif change_type == 'sudden_change':
            # 突然變化 - 快速調整
            adaptation = self._rapid_adaptation(user_id, preference_domain, change_signal)
            
        elif change_type == 'cyclical_variation':
            # 週期性變化 - 學習週期模式
            adaptation = self._cyclical_adaptation(user_id, preference_domain, change_signal)
            
        elif change_type == 'context_dependent':
            # 情境依賴變化 - 學習情境規則
            adaptation = self._contextual_adaptation(user_id, preference_domain, change_signal)
            
        else:
            adaptation = self._default_adaptation(user_id, preference_domain, change_signal)
            
        # 3. 驗證適應效果
        validation = self._validate_adaptation(adaptation)
        
        return AdaptationResult(
            change_type=change_type,
            adaptation_applied=adaptation,
            validation_result=validation,
            confidence=self._calculate_adaptation_confidence(adaptation),
            next_review_date=self._schedule_next_review(change_type)
        )
```

### 2.4 個人化程度的衡量指標

```python
class PersonalizationMetrics:
    """
    個人化程度衡量指標
    """
    
    @staticmethod
    def calculate_comprehensive_metrics(
        user_id: str,
        time_window_days: int = 30
    ) -> PersonalizationScore:
        """
        計算綜合個人化程度評分
        """
        metrics = {}
        
        # 1. 知識深度指標
        metrics['knowledge_depth'] = PersonalizationMetrics._knowledge_depth_score(
            user_id, time_window_days
        )
        
        # 2. 預測準確性指標
        metrics['prediction_accuracy'] = PersonalizationMetrics._prediction_accuracy(
            user_id, time_window_days
        )
        
        # 3. 建議適配性指標
        metrics['recommendation_fit'] = PersonalizationMetrics._recommendation_fit(
            user_id, time_window_days
        )
        
        # 4. 互動效率指標
        metrics['interaction_efficiency'] = PersonalizationMetrics._interaction_efficiency(
            user_id, time_window_days
        )
        
        # 5. 用戶滿意度指標
        metrics['user_satisfaction'] = PersonalizationMetrics._user_satisfaction(
            user_id, time_window_days
        )
        
        # 計算綜合分數
        weights = {
            'knowledge_depth': 0.2,
            'prediction_accuracy': 0.25,
            'recommendation_fit': 0.25,
            'interaction_efficiency': 0.15,
            'user_satisfaction': 0.15
        }
        
        overall_score = sum(
            metrics[k] * weights[k] for k in weights.keys()
        )
        
        return PersonalizationScore(
            overall_score=overall_score,
            component_scores=metrics,
            confidence_interval=PersonalizationMetrics._calculate_ci(metrics),
            trend=PersonalizationMetrics._calculate_trend(user_id),
            benchmark_comparison=PersonalizationMetrics._compare_to_benchmark(metrics)
        )
        
    @staticmethod
    def _knowledge_depth_score(user_id: str, days: int) -> float:
        """
        計算知識深度分數
        
        衡量系統對用戶的了解深度
        """
        profile = get_user_profile(user_id)
        
        # 計算各維度的覆蓋率
        dimensions = {
            'demographics': len(profile.demographics) > 0,
            'goals': len(profile.goals) > 0,
            'preferences': len(profile.preferences) > 0,
            'behavior_patterns': len(profile.behavior_patterns) > 0,
            'constraints': len(profile.constraints) > 0,
            'history': len(profile.interaction_history) > 0
        }
        
        coverage = sum(dimensions.values()) / len(dimensions)
        
        # 計算每個維度的詳細程度
        detail_scores = []
        
        # 目標詳細程度
        if profile.goals:
            goal_detail = np.mean([
                len(g.sub_goals) + len(g.milestones) + len(g.progress_history)
                for g in profile.goals
            ]) / 10  # 標準化
            detail_scores.append(min(goal_detail, 1.0))
            
        # 偏好詳細程度
        if profile.preferences:
            pref_detail = len(profile.preferences) / 20  # 假設20個偏好維度為滿分
            detail_scores.append(min(pref_detail, 1.0))
            
        # 行為模式詳細程度
        if profile.behavior_patterns:
            pattern_detail = len(profile.behavior_patterns) / 10
            detail_scores.append(min(pattern_detail, 1.0))
            
        avg_detail = np.mean(detail_scores) if detail_scores else 0
        
        # 計算更新頻率（反映持續學習）
        recent_updates = count_profile_updates(user_id, days)
        update_frequency = min(recent_updates / days, 1.0)
        
        # 綜合分數
        score = 0.4 * coverage + 0.4 * avg_detail + 0.2 * update_frequency
        
        return min(score, 1.0)
        
    @staticmethod
    def _prediction_accuracy(user_id: str, days: int) -> float:
        """
        計算預測準確性分數
        
        衡量系統預測用戶行為的準確性
        """
        # 獲取預測歷史
        predictions = get_prediction_history(user_id, days)
        
        if not predictions:
            return 0.0
            
        # 計算各類預測的準確率
        accuracy_by_type = defaultdict(list)
        
        for pred in predictions:
            if pred.actual_outcome is not None:
                accuracy = 1.0 if pred.predicted_outcome == pred.actual_outcome else 0.0
                accuracy_by_type[pred.prediction_type].append(accuracy)
                
        # 計算加權平均準確率
        type_weights = {
            'behavior': 0.3,
            'preference': 0.25,
            'response': 0.25,
            'outcome': 0.2
        }
        
        weighted_accuracy = 0
        for pred_type, accuracies in accuracy_by_type.items():
            if accuracies:
                avg_accuracy = np.mean(accuracies)
                weight = type_weights.get(pred_type, 0.2)
                weighted_accuracy += avg_accuracy * weight
                
        # 考慮預測的校準度
        calibration_score = PersonalizationMetrics._calculate_calibration(predictions)
        
        return 0.7 * weighted_accuracy + 0.3 * calibration_score
        
    @staticmethod
    def _recommendation_fit(user_id: str, days: int) -> float:
        """
        計算建議適配性分數
        
        衡量建議與用戶需求的匹配程度
        """
        # 獲取建議歷史
        recommendations = get_recommendation_history(user_id, days)
        
        if not recommendations:
            return 0.0
            
        fit_scores = []
        
        for rec in recommendations:
            # 計算單個建議的適配分數
            fit = 0
            
            # 基於用戶反饋
            if rec.user_feedback:
                fit += rec.user_feedback.rating / 5.0 * 0.3
                
            # 基於採納率
            if rec.adoption_rate is not None:
                fit += rec.adoption_rate * 0.3
                
            # 基於完成率
            if rec.completion_rate is not None:
                fit += rec.completion_rate * 0.25
                
            # 基於目標相關性
            if rec.goal_relevance is not None:
                fit += rec.goal_relevance * 0.15
                
            fit_scores.append(fit)
            
        return np.mean(fit_scores) if fit_scores else 0.0
```

---

## 3. 知識庫進化

### 3.1 三層知識建築的更新機制

#### 3.1.1 理論層知識更新

```python
class TheoreticalKnowledgeUpdater:
    """
    理論層知識更新器 - 更新教科書級別的權威知識
    """
    
    def __init__(self):
        self.source_validator = AcademicSourceValidator()
        self.consensus_analyzer = ScientificConsensusAnalyzer()
        self.conflict_resolver = KnowledgeConflictResolver()
        
    UPDATE_SOURCES = {
        'peer_reviewed_journals': {
            'weight': 1.0,
            'update_frequency': 'monthly',
            'validation_required': True
        },
        'systematic_reviews': {
            'weight': 0.95,
            'update_frequency': 'quarterly',
            'validation_required': True
        },
        'clinical_guidelines': {
            'weight': 0.9,
            'update_frequency': 'annually',
            'validation_required': True
        },
        'expert_consensus': {
            'weight': 0.85,
            'update_frequency': 'semi_annually',
            'validation_required': True
        }
    }
    
    def update_theoretical_knowledge(
        self,
        domain: str,
        update_trigger: str = 'scheduled'
    ) -> KnowledgeUpdateResult:
        """
        更新理論層知識
        """
        # 1. 搜索最新學術來源
        new_sources = self._search_academic_sources(domain)
        
        # 2. 驗證來源質量
        validated_sources = [
            s for s in new_sources 
            if self.source_validator.validate(s)
        ]
        
        # 3. 提取知識聲明
        knowledge_claims = []
        for source in validated_sources:
            claims = self._extract_knowledge_claims(source)
            knowledge_claims.extend(claims)
            
        # 4. 分析科學共識
        consensus_analysis = self.consensus_analyzer.analyze(
            knowledge_claims
        )
        
        # 5. 識別與現有知識的衝突
        current_knowledge = self._get_current_theoretical_knowledge(domain)
        conflicts = self._identify_conflicts(
            consensus_analysis, current_knowledge
        )
        
        # 6. 解決衝突
        resolved_conflicts = self.conflict_resolver.resolve(
            conflicts,
            resolution_strategy='evidence_based'
        )
        
        # 7. 生成更新計劃
        update_plan = self._generate_update_plan(
            validated_sources,
            consensus_analysis,
            resolved_conflicts
        )
        
        return KnowledgeUpdateResult(
            domain=domain,
            sources_reviewed=len(new_sources),
            sources_validated=len(validated_sources),
            new_claims_identified=len(knowledge_claims),
            consensus_level=consensus_analysis.consensus_level,
            conflicts_resolved=len(resolved_conflicts),
            update_plan=update_plan,
            confidence_score=self._calculate_update_confidence(
                validated_sources, consensus_analysis
            )
        )
        
    def _search_academic_sources(self, domain: str) -> List[AcademicSource]:
        """
        搜索相關學術來源
        """
        sources = []
        
        # PubMed/Medline搜索
        pubmed_results = self._search_pubmed(domain)
        sources.extend(pubmed_results)
        
        # Google Scholar搜索
        scholar_results = self._search_google_scholar(domain)
        sources.extend(scholar_results)
        
        # 專業數據庫搜索
        if domain in ['fitness', 'nutrition']:
            sports_results = self._search_sports_medicine_db(domain)
            sources.extend(sports_results)
        elif domain in ['mental_health', 'psychology']:
            psych_results = self._search_psychology_db(domain)
            sources.extend(psych_results)
            
        # 去重和排序
        unique_sources = self._deduplicate_sources(sources)
        sorted_sources = sorted(
            unique_sources,
            key=lambda s: s.credibility_score,
            reverse=True
        )
        
        return sorted_sources[:100]  # 返回前100個最相關的來源
        
    class ScientificConsensusAnalyzer:
        """
        科學共識分析器 - 分析研究結果的一致性
        """
        
        def analyze(
            self,
            knowledge_claims: List[KnowledgeClaim]
        ) -> ConsensusAnalysis:
            """
            分析知識聲明的科學共識程度
            """
            # 按主題分組
            claims_by_topic = defaultdict(list)
            for claim in knowledge_claims:
                topic = self._extract_topic(claim)
                claims_by_topic[topic].append(claim)
                
            topic_consensus = {}
            
            for topic, claims in claims_by_topic.items():
                # 1. 計算效應量的一致性
                effect_sizes = [
                    c.effect_size for c in claims 
                    if c.effect_size is not None
                ]
                
                if effect_sizes:
                    effect_consistency = self._calculate_effect_consistency(
                        effect_sizes
                    )
                else:
                    effect_consistency = None
                    
                # 2. 計算結論一致性
                conclusions = [c.conclusion for c in claims]
                conclusion_consistency = self._calculate_conclusion_consistency(
                    conclusions
                )
                
                # 3. 計算方法學質量加權的一致性
                quality_weighted = self._calculate_quality_weighted_consensus(
                    claims
                )
                
                # 4. 檢測發表偏倚
                publication_bias = self._detect_publication_bias(claims)
                
                # 5. 綜合共識分數
                consensus_score = self._aggregate_consensus_metrics(
                    effect_consistency,
                    conclusion_consistency,
                    quality_weighted,
                    publication_bias
                )
                
                topic_consensus[topic] = {
                    'consensus_score': consensus_score,
                    'evidence_strength': self._assess_evidence_strength(claims),
                    'confidence_interval': self._calculate_consensus_ci(claims),
                    'heterogeneity': self._assess_heterogeneity(claims),
                    'recommendation': self._generate_recommendation(
                        consensus_score, claims
                    )
                }
                
            return ConsensusAnalysis(
                topic_consensus=topic_consensus,
                overall_consensus=np.mean([
                    t['consensus_score'] for t in topic_consensus.values()
                ]),
                high_confidence_topics=[
                    t for t, v in topic_consensus.items()
                    if v['consensus_score'] > 0.8
                ],
                contested_topics=[
                    t for t, v in topic_consensus.items()
                    if v['consensus_score'] < 0.5
                ]
            )
            
        def _calculate_effect_consistency(
            self,
            effect_sizes: List[float]
        ) -> float:
            """
            計算效應量的一致性（使用I²統計量）
            """
            if len(effect_sizes) < 2:
                return 1.0
                
            # 計算異質性
            mean_effect = np.mean(effect_sizes)
            variance = np.var(effect_sizes, ddof=1)
            
            # I² = (Q - df) / Q * 100%
            # 簡化計算：使用變異係數的倒數
            cv = np.std(effect_sizes) / abs(mean_effect) if mean_effect != 0 else float('inf')
            
            consistency = max(0, 1 - cv)
            
            return consistency
```

#### 3.1.2 案例層知識更新

```python
class CaseStudyKnowledgeUpdater:
    """
    案例層知識更新器 - 更新權威案例庫
    """
    
    def __init__(self):
        self.case_validator = CaseStudyValidator()
        self.pattern_extractor = CasePatternExtractor()
        self.effectiveness_evaluator = CaseEffectivenessEvaluator()
        
    def update_case_knowledge(
        self,
        domain: str,
        new_cases: List[CaseStudy] = None
    ) -> CaseUpdateResult:
        """
        更新案例層知識
        """
        # 1. 收集新案例
        if new_cases is None:
            new_cases = self._collect_new_cases(domain)
            
        # 2. 驗證案例質量
        validated_cases = [
            case for case in new_cases
            if self.case_validator.validate(case)
        ]
        
        # 3. 提取案例模式
        case_patterns = self.pattern_extractor.extract(validated_cases)
        
        # 4. 評估案例有效性
        effectiveness_scores = {
            case.id: self.effectiveness_evaluator.evaluate(case)
            for case in validated_cases
        }
        
        # 5. 整合到案例庫
        integration_plan = self._plan_case_integration(
            validated_cases,
            case_patterns,
            effectiveness_scores
        )
        
        # 6. 更新案例相似度索引
        self._update_similarity_index(domain, validated_cases)
        
        return CaseUpdateResult(
            domain=domain,
            cases_collected=len(new_cases),
            cases_validated=len(validated_cases),
            patterns_extracted=len(case_patterns),
            high_effectiveness_cases=sum(
                1 for s in effectiveness_scores.values() if s > 0.8
            ),
            integration_plan=integration_plan,
            coverage_improvement=self._estimate_coverage_improvement(
                domain, validated_cases
            )
        )
        
    def _collect_new_cases(self, domain: str) -> List[CaseStudy]:
        """
        收集新的案例研究
        """
        cases = []
        
        # 從多個來源收集
        sources = {
            'clinical_trials': self._search_clinical_trials(domain),
            'expert_publications': self._search_expert_case_reports(domain),
            'institutional_reports': self._search_institutional_reports(domain),
            'validated_user_cases': self._get_validated_user_cases(domain)
        }
        
        for source_name, source_cases in sources.items():
            for case in source_cases:
                case.source_type = source_name
                case.collection_date = datetime.now()
                cases.append(case)
                
        return cases
        
    class CasePatternExtractor:
        """
        案例模式提取器 - 從案例中提取可複用的模式
        """
        
        def extract(
            self,
            cases: List[CaseStudy]
        ) -> List[CasePattern]:
            """
            從案例中提取模式
            """
            patterns = []
            
            # 1. 序列模式（干預順序）
            sequence_patterns = self._extract_sequence_patterns(cases)
            patterns.extend(sequence_patterns)
            
            # 2. 特徵-結果關聯模式
            feature_outcome_patterns = self._extract_feature_outcome_patterns(cases)
            patterns.extend(feature_outcome_patterns)
            
            # 3. 情境-策略匹配模式
            context_strategy_patterns = self._extract_context_strategy_patterns(cases)
            patterns.extend(context_strategy_patterns)
            
            # 4. 成功因素模式
            success_factor_patterns = self._extract_success_factors(cases)
            patterns.extend(success_factor_patterns)
            
            # 過濾和排序
            significant_patterns = self._filter_significant_patterns(patterns)
            
            return significant_patterns
            
        def _extract_feature_outcome_patterns(
            self,
            cases: List[CaseStudy]
        ) -> List[CasePattern]:
            """
            提取特徵與結果的關聯模式
            
            使用關聯規則挖掘
            """
            # 準備交易數據
            transactions = []
            for case in cases:
                transaction = set()
                
                # 添加特徵
                for feature, value in case.features.items():
                    transaction.add(f"{feature}={value}")
                    
                # 添加結果
                for outcome, value in case.outcomes.items():
                    if value > 0.7:  # 顯著結果
                        transaction.add(f"OUTCOME:{outcome}")
                        
                transactions.append(transaction)
                
            # 運行Apriori算法
            from mlxtend.frequent_patterns import apriori, association_rules
            
            # 轉換為one-hot編碼
            all_items = set()
            for t in transactions:
                all_items.update(t)
                
            item_list = sorted(list(all_items))
            
            # 創建二元矩陣
            binary_matrix = []
            for t in transactions:
                row = [1 if item in t else 0 for item in item_list]
                binary_matrix.append(row)
                
            df = pd.DataFrame(binary_matrix, columns=item_list)
            
            # 挖掘頻繁項集
            frequent_itemsets = apriori(
                df, 
                min_support=0.1, 
                use_colnames=True
            )
            
            # 生成關聯規則
            rules = association_rules(
                frequent_itemsets, 
                metric="confidence", 
                min_threshold=0.7
            )
            
            # 提取包含結果的規則
            outcome_rules = rules[
                rules['consequents'].apply(
                    lambda x: any('OUTCOME:' in item for item in x)
                )
            ]
            
            patterns = []
            for _, rule in outcome_rules.iterrows():
                antecedents = [item for item in rule['antecedents']]
                consequents = [item for item in rule['consequents']]
                
                pattern = CasePattern(
                    pattern_type='feature_outcome_association',
                    antecedents=antecedents,
                    consequents=consequents,
                    support=rule['support'],
                    confidence=rule['confidence'],
                    lift=rule['lift'],
                    applicable_cases=int(rule['support'] * len(cases))
                )
                patterns.append(pattern)
                
            return patterns
```

#### 3.1.3 社群層知識更新

```python
class CommunityKnowledgeUpdater:
    """
    社群層知識更新器 - 更新動態社群智慧
    """
    
    def __init__(self):
        self.sentiment_analyzer = CommunitySentimentAnalyzer()
        self.trend_detector = CommunityTrendDetector()
        self.credibility_scorer = CommunityCredibilityScorer()
        
    def update_community_knowledge(
        self,
        domain: str,
        update_frequency: str = 'daily'
    ) -> CommunityUpdateResult:
        """
        更新社群層知識
        """
        # 1. 收集社群數據
        community_data = self._collect_community_data(domain)
        
        # 2. 分析社群情緒
        sentiment_analysis = self.sentiment_analyzer.analyze(community_data)
        
        # 3. 檢測新興趨勢
        emerging_trends = self.trend_detector.detect(community_data)
        
        # 4. 評估資訊可信度
        credibility_scores = self.credibility_scorer.score(community_data)
        
        # 5. 整合高可信度見解
        validated_insights = self._integrate_insights(
            community_data,
            credibility_scores,
            sentiment_analysis
        )
        
        # 6. 更新社群知識圖譜
        knowledge_graph_update = self._update_knowledge_graph(
            domain, validated_insights
        )
        
        return CommunityUpdateResult(
            domain=domain,
            data_sources_processed=len(community_data),
            sentiment_summary=sentiment_analysis.summary,
            trends_identified=len(emerging_trends),
            high_credibility_insights=len(validated_insights),
            knowledge_graph_update=knowledge_graph_update,
            update_timestamp=datetime.now()
        )
        
    def _collect_community_data(self, domain: str) -> List[CommunityData]:
        """
        收集社群數據
        """
        data = []
        
        # 論壇和討論區
        forum_data = self._scrape_forums(domain)
        data.extend(forum_data)
        
        # 社交媒體
        social_data = self._collect_social_media(domain)
        data.extend(social_data)
        
        # 用戶生成內容
        ugc_data = self._collect_user_generated_content(domain)
        data.extend(ugc_data)
        
        # 專家社群
        expert_data = self._collect_expert_community_content(domain)
        data.extend(expert_data)
        
        return data
        
    class CommunityTrendDetector:
        """
        社群趨勢檢測器 - 檢測新興話題和趨勢
        """
        
        def detect(
            self,
            community_data: List[CommunityData],
            detection_method: str = 'burst_detection'
        ) -> List[CommunityTrend]:
            """
            檢測社群中的新興趨勢
            """
            if detection_method == 'burst_detection':
                return self._burst_detection(community_data)
            elif detection_method == 'topic_modeling':
                return self._topic_modeling_detection(community_data)
            else:
                raise ValueError(f"Unknown method: {detection_method}")
                
        def _burst_detection(
            self,
            community_data: List[CommunityData]
        ) -> List[CommunityTrend]:
            """
            使用突發檢測算法識別新興趨勢
            
            基於Kleinberg的突發檢測算法
            """
            from collections import defaultdict
            
            # 按時間聚合關鍵詞出現
            keyword_timeline = defaultdict(lambda: defaultdict(int))
            
            for item in community_data:
                timestamp = item.timestamp
                keywords = self._extract_keywords(item.content)
                
                for keyword in keywords:
                    keyword_timeline[keyword][timestamp.date()] += 1
                    
            trends = []
            
            for keyword, timeline in keyword_timeline.items():
                # 轉換為時間序列
                dates = sorted(timeline.keys())
                counts = [timeline[d] for d in dates]
                
                # 計算移動平均
                window = 7
                if len(counts) >= window:
                    moving_avg = np.convolve(
                        counts, 
                        np.ones(window)/window, 
                        mode='valid'
                    )
                    
                    # 檢測突發
                    baseline = np.mean(moving_avg[:-window])
                    recent = np.mean(moving_avg[-window:])
                    
                    if recent > baseline * 2:  # 超過基線2倍
                        burst_score = (recent - baseline) / baseline
                        
                        trend = CommunityTrend(
                            keyword=keyword,
                            trend_type='emerging_topic',
                            burst_score=burst_score,
                            start_date=dates[0],
                            peak_date=dates[np.argmax(counts)],
                            volume_change=(recent - baseline) / baseline,
                            confidence=self._calculate_trend_confidence(
                                counts, burst_score
                            )
                        )
                        trends.append(trend)
                        
            # 按突發分數排序
            trends.sort(key=lambda x: x.burst_score, reverse=True)
            
            return trends[:20]  # 返回前20個趨勢
```

### 3.2 新知識的驗證與整合流程

```python
class KnowledgeValidationPipeline:
    """
    知識驗證管道 - 驗證新知識的可靠性
    """
    
    VALIDATION_STAGES = [
        'source_credibility',
        'factual_accuracy',
        'consistency_check',
        'expert_review',
        'pilot_testing'
    ]
    
    def validate_new_knowledge(
        self,
        knowledge_item: KnowledgeItem,
        validation_level: str = 'standard'
    ) -> ValidationResult:
        """
        驗證新知識項
        """
        validation_results = {}
        
        for stage in self.VALIDATION_STAGES:
            if validation_level == 'minimal' and stage in ['expert_review', 'pilot_testing']:
                continue
                
            validator = self._get_validator(stage)
            result = validator.validate(knowledge_item)
            validation_results[stage] = result
            
            # 如果某階段失敗，提前終止
            if not result.passed and validation_level != 'permissive':
                break
                
        overall_score = self._calculate_overall_validation_score(
            validation_results
        )
        
        return ValidationResult(
            knowledge_id=knowledge_item.id,
            validation_level=validation_level,
            stage_results=validation_results,
            overall_score=overall_score,
            status='approved' if overall_score > 0.8 else 'rejected',
            confidence=self._calculate_validation_confidence(validation_results)
        )
        
class KnowledgeIntegrationEngine:
    """
    知識整合引擎 - 將驗證後的知識整合到知識庫
    """
    
    def integrate_knowledge(
        self,
        validated_knowledge: List[KnowledgeItem],
        integration_strategy: str = 'conservative'
    ) -> IntegrationResult:
        """
        整合驗證後的知識
        """
        integration_log = []
        
        for knowledge in validated_knowledge:
            # 1. 檢查與現有知識的關係
            relationships = self._analyze_knowledge_relationships(knowledge)
            
            # 2. 決定整合方式
            if relationships['is_duplicate']:
                action = 'skip'
                
            elif relationships['is_refinement']:
                action = 'update_existing'
                
            elif relationships['is_extension']:
                action = 'add_as_extension'
                
            elif relationships['is_contradiction']:
                action = self._resolve_contradiction(
                    knowledge, relationships['contradicted_knowledge']
                )
                
            else:  # 全新知識
                action = 'add_new'
                
            # 3. 執行整合
            if action == 'add_new':
                result = self._add_new_knowledge(knowledge)
                
            elif action == 'update_existing':
                result = self._update_existing_knowledge(
                    relationships['related_knowledge'],
                    knowledge
                )
                
            elif action == 'add_as_extension':
                result = self._add_knowledge_extension(
                    relationships['parent_knowledge'],
                    knowledge
                )
                
            elif action == 'flag_for_review':
                result = self._flag_for_manual_review(knowledge, relationships)
                
            else:
                result = {'status': 'skipped', 'reason': action}
                
            integration_log.append({
                'knowledge_id': knowledge.id,
                'action': action,
                'result': result
            })
            
        return IntegrationResult(
            total_items=len(validated_knowledge),
            successfully_integrated=sum(
                1 for log in integration_log 
                if log['result']['status'] == 'success'
            ),
            integration_log=integration_log,
            knowledge_graph_impact=self._assess_kg_impact(integration_log)
        )
```

### 3.3 過時知識的淘汰機制

```python
class KnowledgeDeprecationEngine:
    """
    知識淘汰引擎 - 識別和淘汰過時知識
    """
    
    def __init__(self):
        self.obsolescence_detector = ObsolescenceDetector()
        self.impact_analyzer = DeprecationImpactAnalyzer()
        
    DEPRECATION_TRIGGERS = {
        'superseded': {
            'description': '被新的、更準確的知識取代',
            'auto_deprecate': True
        },
        'contradicted': {
            'description': '被新的證據反駁',
            'auto_deprecate': False  # 需要人工審核
        },
        'expired': {
            'description': '超過有效期限',
            'auto_deprecate': True
        },
        'low_usage': {
            'description': '長期未被使用',
            'auto_deprecate': True
        },
        'low_effectiveness': {
            'description': '實際效果數據顯示不佳',
            'auto_deprecate': False
        }
    }
    
    def identify_deprecated_knowledge(
        self,
        domain: str = None,
        scan_type: str = 'full'
    ) -> DeprecationScanResult:
        """
        識別需要淘汰的知識
        """
        deprecated_candidates = []
        
        # 1. 檢查被取代的知識
        superseded = self._find_superseded_knowledge(domain)
        deprecated_candidates.extend(superseded)
        
        # 2. 檢查被反駁的知識
        contradicted = self._find_contradicted_knowledge(domain)
        deprecated_candidates.extend(contradicted)
        
        # 3. 檢查過期的知識
        expired = self._find_expired_knowledge(domain)
        deprecated_candidates.extend(expired)
        
        # 4. 檢查低使用率的知識
        low_usage = self._find_low_usage_knowledge(domain)
        deprecated_candidates.extend(low_usage)
        
        # 5. 檢查低效果的知識
        low_effectiveness = self._find_low_effectiveness_knowledge(domain)
        deprecated_candidates.extend(low_effectiveness)
        
        # 分析影響
        impact_analysis = self.impact_analyzer.analyze(deprecated_candidates)
        
        return DeprecationScanResult(
            scan_timestamp=datetime.now(),
            domain_scanned=domain or 'all',
            candidates_found=len(deprecated_candidates),
            by_trigger_type=self._categorize_by_trigger(deprecated_candidates),
            impact_analysis=impact_analysis,
            auto_deprecatable=sum(
                1 for c in deprecated_candidates
                if self.DEPRECATION_TRIGGERS[c.trigger_type]['auto_deprecate']
            ),
            requires_review=sum(
                1 for c in deprecated_candidates
                if not self.DEPRECATION_TRIGGERS[c.trigger_type]['auto_deprecate']
            )
        )
        
    def _find_superseded_knowledge(self, domain: str) -> List[DeprecationCandidate]:
        """
        找到被取代的知識
        """
        candidates = []
        
        # 獲取所有知識項
        knowledge_items = self._get_knowledge_items(domain)
        
        for item in knowledge_items:
            # 檢查是否有更高版本或更準確的替代
            newer_versions = self._find_newer_versions(item)
            
            if newer_versions:
                # 比較準確性和覆蓋範圍
                best_newer = max(newer_versions, key=lambda x: x.accuracy_score)
                
                if best_newer.accuracy_score > item.accuracy_score * 1.2:
                    candidates.append(DeprecationCandidate(
                        knowledge_item=item,
                        trigger_type='superseded',
                        trigger_evidence={
                            'superseded_by': best_newer.id,
                            'accuracy_improvement': (
                                best_newer.accuracy_score - item.accuracy_score
                            ) / item.accuracy_score
                        },
                        deprecation_urgency='medium'
                    ))
                    
        return candidates
        
    def _find_low_effectiveness_knowledge(
        self,
        domain: str,
        min_samples: int = 10
    ) -> List[DeprecationCandidate]:
        """
        找到實際效果不佳的知識
        """
        candidates = []
        
        knowledge_items = self._get_knowledge_items(domain)
        
        for item in knowledge_items:
            # 獲取效果數據
            effectiveness_data = self._get_effectiveness_data(item.id)
            
            if len(effectiveness_data) >= min_samples:
                avg_effectiveness = np.mean([
                    d.effectiveness_score for d in effectiveness_data
                ])
                
                if avg_effectiveness < 0.4:  # 效果低於40%
                    candidates.append(DeprecationCandidate(
                        knowledge_item=item,
                        trigger_type='low_effectiveness',
                        trigger_evidence={
                            'sample_size': len(effectiveness_data),
                            'avg_effectiveness': avg_effectiveness,
                            'effectiveness_distribution': self._calculate_distribution(
                                effectiveness_data
                            )
                        },
                        deprecation_urgency='high'
                    ))
                    
        return candidates
        
    def deprecate_knowledge(
        self,
        deprecation_candidates: List[DeprecationCandidate],
        deprecation_action: str = 'archive'
    ) -> DeprecationResult:
        """
        執行知識淘汰
        """
        results = []
        
        for candidate in deprecation_candidates:
            # 檢查是否可以自動淘汰
            if not self.DEPRECATION_TRIGGERS[candidate.trigger_type]['auto_deprecate']:
                # 標記為待審核
                result = self._flag_for_review(candidate)
                results.append(result)
                continue
                
            # 執行淘汰
            if deprecation_action == 'archive':
                result = self._archive_knowledge(candidate)
                
            elif deprecation_action == 'delete':
                result = self._delete_knowledge(candidate)
                
            elif deprecation_action == 'deprecate_with_warning':
                result = self._deprecate_with_warning(candidate)
                
            else:
                raise ValueError(f"Unknown action: {deprecation_action}")
                
            results.append(result)
            
        return DeprecationResult(
            total_candidates=len(deprecation_candidates),
            successfully_processed=sum(1 for r in results if r.success),
            failed=sum(1 for r in results if not r.success),
            details=results,
            rollback_plan=self._create_rollback_plan(results)
        )
```

### 3.4 用戶專屬知識庫的構建

```python
class UserSpecificKnowledgeBuilder:
    """
    用戶專屬知識庫構建器 - 為每個用戶構建個性化知識庫
    """
    
    def __init__(self):
        self.personalizer = KnowledgePersonalizer()
        self.effectiveness_tracker = UserKnowledgeEffectivenessTracker()
        
    def build_user_knowledge_base(
        self,
        user_id: str,
        build_strategy: str = 'adaptive'
    ) -> UserKnowledgeBase:
        """
        構建用戶專屬知識庫
        """
        # 1. 獲取用戶畫像
        user_profile = self._get_user_profile(user_id)
        
        # 2. 從通用知識庫篩選相關知識
        relevant_knowledge = self._select_relevant_knowledge(user_profile)
        
        # 3. 個性化知識表達
        personalized_knowledge = self.personalizer.personalize(
            relevant_knowledge,
            user_profile
        )
        
        # 4. 添加用戶特定知識
        user_specific = self._add_user_specific_knowledge(user_id)
        
        # 5. 整合效果數據
        effectiveness_data = self.effectiveness_tracker.get_data(user_id)
        
        # 6. 構建知識圖譜
        knowledge_graph = self._build_personal_kg(
            personalized_knowledge,
            user_specific,
            effectiveness_data
        )
        
        return UserKnowledgeBase(
            user_id=user_id,
            personalized_knowledge=personalized_knowledge,
            user_specific_knowledge=user_specific,
            knowledge_graph=knowledge_graph,
            effectiveness_ranking=effectiveness_data,
            last_updated=datetime.now(),
            version=self._calculate_version(user_id)
        )
        
    def _select_relevant_knowledge(
        self,
        user_profile: UserProfile
    ) -> List[KnowledgeItem]:
        """
        根據用戶畫像選擇相關知識
        """
        # 基於用戶目標選擇
        goal_relevant = []
        for goal in user_profile.goals:
            relevant = self._search_knowledge_by_goal(goal)
            goal_relevant.extend(relevant)
            
        # 基於用戶偏好選擇
        preference_relevant = []
        for pref_domain, pref_value in user_profile.preferences.items():
            relevant = self._search_knowledge_by_preference(
                pref_domain, pref_value
            )
            preference_relevant.extend(relevant)
            
        # 基於用戶當前狀態選擇
        state_relevant = self._search_knowledge_by_state(
            user_profile.current_state
        )
        
        # 合併和去重
        all_relevant = goal_relevant + preference_relevant + state_relevant
        
        # 使用向量相似度排序
        user_vector = self._encode_user_profile(user_profile)
        
        scored_knowledge = []
        for knowledge in set(all_relevant):
            knowledge_vector = self._encode_knowledge(knowledge)
            similarity = cosine_similarity([user_vector], [knowledge_vector])[0][0]
            scored_knowledge.append((knowledge, similarity))
            
        # 按相似度排序，返回前N個
        scored_knowledge.sort(key=lambda x: x[1], reverse=True)
        
        return [k for k, s in scored_knowledge[:500]]  # 返回最相關的500個
        
    class KnowledgePersonalizer:
        """
        知識個性化器 - 根據用戶特徵調整知識表達
        """
        
        def personalize(
            self,
            knowledge_items: List[KnowledgeItem],
            user_profile: UserProfile
        ) -> List[PersonalizedKnowledgeItem]:
            """
            個性化知識項
            """
            personalized = []
            
            for item in knowledge_items:
                # 1. 調整語言風格
                adjusted_content = self._adjust_language_style(
                    item.content,
                    user_profile.communication_preferences
                )
                
                # 2. 調整詳細程度
                adjusted_detail = self._adjust_detail_level(
                    adjusted_content,
                    user_profile.knowledge_level.get(item.domain, 'intermediate')
                )
                
                # 3. 調整示例和類比
                adjusted_examples = self._adjust_examples(
                    adjusted_detail,
                    user_profile.interests,
                    user_profile.background
                )
                
                # 4. 調整行動建議
                adjusted_actions = self._adjust_action_recommendations(
                    item.action_recommendations,
                    user_profile.constraints,
                    user_profile.resources
                )
                
                personalized_item = PersonalizedKnowledgeItem(
                    original_item=item,
                    personalized_content=adjusted_examples,
                    personalized_actions=adjusted_actions,
                    personalization_factors={
                        'language_style': user_profile.communication_preferences,
                        'detail_level': user_profile.knowledge_level.get(item.domain),
                        'example_domain': user_profile.interests
                    },
                    confidence=self._calculate_personalization_confidence(
                        item, user_profile
                    )
                )
                personalized.append(personalized_item)
                
            return personalized
            
        def _adjust_language_style(
            self,
            content: str,
            communication_prefs: CommunicationPreferences
        ) -> str:
            """
            根據溝通偏好調整語言風格
            """
            # 使用LLM進行風格轉換
            style_prompt = f"""
            將以下內容調整為符合用戶偏好的風格：
            
            用戶偏好：
            - 正式程度：{communication_prefs.formality_level}/5
            - 技術性：{communication_prefs.technical_level}/5
            - 激勵性：{'是' if communication_prefs.prefers_motivational else '否'}
            - 簡潔性：{'是' if communication_prefs.prefers_concise else '否'}
            
            原始內容：
            {content}
            
            請調整語言風格後輸出：
            """
            
            adjusted = self.llm.generate(style_prompt)
            return adjusted
```

---

## 4. Agent自我優化

### 4.1 Agent決策邏輯的學習機制

```python
class AgentDecisionLearningEngine:
    """
    Agent決策學習引擎 - 學習和優化Agent的決策邏輯
    """
    
    def __init__(self):
        self.policy_optimizer = PolicyOptimizer()
        self.reward_model = RewardModel()
        self.experience_replay = ExperienceReplayBuffer()
        
    def learn_from_interactions(
        self,
        agent_id: str,
        learning_mode: str = 'online'
    ) -> LearningResult:
        """
        從互動中學習決策策略
        """
        # 1. 收集互動經驗
        experiences = self.experience_replay.sample(
            agent_id=agent_id,
            batch_size=1000
        )
        
        # 2. 計算獎勵
        rewarded_experiences = [
            self._compute_reward(exp) for exp in experiences
        ]
        
        # 3. 更新策略
        if learning_mode == 'online':
            updated_policy = self.policy_optimizer.online_update(
                agent_id, rewarded_experiences
            )
        elif learning_mode == 'batch':
            updated_policy = self.policy_optimizer.batch_update(
                agent_id, rewarded_experiences
            )
        elif learning_mode == 'reinforcement':
            updated_policy = self._reinforcement_learning_update(
                agent_id, rewarded_experiences
            )
            
        # 4. 驗證新策略
        validation = self._validate_policy(updated_policy)
        
        return LearningResult(
            agent_id=agent_id,
            samples_processed=len(experiences),
            policy_improvement=validation.improvement_score,
            new_policy_version=updated_policy.version,
            validation_result=validation,
            confidence=self._calculate_learning_confidence(rewarded_experiences)
        )
        
    class PolicyOptimizer:
        """
        策略優化器 - 使用多種方法優化決策策略
        """
        
        def __init__(self):
            self.methods = {
                'contextual_bandit': ContextualBanditOptimizer(),
                'reinforcement_learning': RLOptimizer(),
                'imitation_learning': ImitationLearner(),
                'bayesian_optimization': BayesianPolicyOptimizer()
            }
            
        def online_update(
            self,
            agent_id: str,
            experiences: List[RewardedExperience]
        ) -> AgentPolicy:
            """
            在線策略更新
            
            使用上下文老虎機進行快速適應
            """
            optimizer = self.methods['contextual_bandit']
            
            # 更新每個決策點的獎勵估計
            for exp in experiences:
                context = exp.state
                action = exp.action
                reward = exp.reward
                
                optimizer.update(context, action, reward)
                
            # 生成更新後的策略
            current_policy = self._get_current_policy(agent_id)
            updated_policy = optimizer.get_policy()
            
            # 平滑過渡
            smoothed_policy = self._smooth_policy_transition(
                current_policy, updated_policy, alpha=0.1
            )
            
            return smoothed_policy
            
        def batch_update(
            self,
            agent_id: str,
            experiences: List[RewardedExperience]
        ) -> AgentPolicy:
            """
            批量策略更新
            
            使用監督學習從成功經驗中學習
            """
            # 分類成功和失敗經驗
            successful = [e for e in experiences if e.reward > 0.7]
            failed = [e for e in experiences if e.reward < 0.3]
            
            # 訓練分類器預測成功行動
            from sklearn.ensemble import GradientBoostingClassifier
            
            # 準備訓練數據
            X_success = [self._encode_state_action(e) for e in successful]
            X_failed = [self._encode_state_action(e) for e in failed]
            
            X = X_success + X_failed
            y = [1] * len(X_success) + [0] * len(X_failed)
            
            # 訓練模型
            model = GradientBoostingClassifier(n_estimators=100)
            model.fit(X, y)
            
            # 構建策略
            policy = self._build_policy_from_model(model)
            
            return policy
            
    class ContextualBanditOptimizer:
        """
        上下文老虎機優化器 - 在線學習最優決策
        """
        
        def __init__(self, n_actions: int, context_dim: int):
            self.n_actions = n_actions
            self.context_dim = context_dim
            
            # LinUCB參數
            self.A = [np.eye(context_dim) for _ in range(n_actions)]
            self.b = [np.zeros(context_dim) for _ in range(n_actions)]
            self.alpha = 1.0  # 探索參數
            
        def update(self, context: np.ndarray, action: int, reward: float):
            """
            更新老虎機參數
            """
            self.A[action] += np.outer(context, context)
            self.b[action] += reward * context
            
        def select_action(self, context: np.ndarray) -> int:
            """
            選擇動作（UCB策略）
            """
            ucb_scores = []
            
            for a in range(self.n_actions):
                A_inv = np.linalg.inv(self.A[a])
                theta = A_inv @ self.b[a]
                
                # 預測獎勵
                predicted_reward = theta @ context
                
                # 不確定性
                uncertainty = self.alpha * np.sqrt(context @ A_inv @ context)
                
                # UCB分數
                ucb_score = predicted_reward + uncertainty
                ucb_scores.append(ucb_score)
                
            return np.argmax(ucb_scores)
            
    def _reinforcement_learning_update(
        self,
        agent_id: str,
        experiences: List[RewardedExperience]
    ) -> AgentPolicy:
        """
        使用強化學習更新策略
        
        實現PPO (Proximal Policy Optimization)
        """
        import torch
        import torch.nn as nn
        import torch.optim as optim
        
        # 定義策略網絡
        class PolicyNetwork(nn.Module):
            def __init__(self, state_dim, action_dim):
                super().__init__()
                self.fc1 = nn.Linear(state_dim, 128)
                self.fc2 = nn.Linear(128, 128)
                self.fc3 = nn.Linear(128, action_dim)
                
            def forward(self, x):
                x = torch.relu(self.fc1(x))
                x = torch.relu(self.fc2(x))
                return torch.softmax(self.fc3(x), dim=-1)
                
        # 定義價值網絡
        class ValueNetwork(nn.Module):
            def __init__(self, state_dim):
                super().__init__()
                self.fc1 = nn.Linear(state_dim, 128)
                self.fc2 = nn.Linear(128, 128)
                self.fc3 = nn.Linear(128, 1)
                
            def forward(self, x):
                x = torch.relu(self.fc1(x))
                x = torch.relu(self.fc2(x))
                return self.fc3(x)
                
        # 初始化網絡
        state_dim = len(experiences[0].state)
        action_dim = len(set(e.action for e in experiences))
        
        policy_net = PolicyNetwork(state_dim, action_dim)
        value_net = ValueNetwork(state_dim)
        
        policy_optimizer = optim.Adam(policy_net.parameters(), lr=3e-4)
        value_optimizer = optim.Adam(value_net.parameters(), lr=3e-4)
        
        # PPO訓練
        for epoch in range(10):
            # 計算優勢函數
            states = torch.FloatTensor([e.state for e in experiences])
            actions = torch.LongTensor([e.action for e in experiences])
            rewards = torch.FloatTensor([e.reward for e in experiences])
            
            # 計算舊策略的概率
            with torch.no_grad():
                old_probs = policy_net(states)
                old_action_probs = old_probs.gather(1, actions.unsqueeze(1))
                values = value_net(states).squeeze()
                
            # 計算回報和優勢
            returns = self._compute_returns(rewards, values, gamma=0.99)
            advantages = returns - values
            
            # PPO更新
            for _ in range(4):  # 每個epoch多次更新
                probs = policy_net(states)
                action_probs = probs.gather(1, actions.unsqueeze(1))
                
                # 概率比率
                ratio = action_probs / (old_action_probs + 1e-8)
                
                # PPO損失
                surr1 = ratio * advantages
                surr2 = torch.clamp(ratio, 0.8, 1.2) * advantages
                policy_loss = -torch.min(surr1, surr2).mean()
                
                # 價值損失
                new_values = value_net(states).squeeze()
                value_loss = nn.MSELoss()(new_values, returns)
                
                # 總損失
                loss = policy_loss + 0.5 * value_loss
                
                # 更新
                policy_optimizer.zero_grad()
                value_optimizer.zero_grad()
                loss.backward()
                policy_optimizer.step()
                value_optimizer.step()
                
        # 保存更新後的策略
        return AgentPolicy(
            agent_id=agent_id,
            policy_network=policy_net,
            value_network=value_net,
            version=self._get_next_version(agent_id)
        )
```

### 4.2 協作效率的持續優化

```python
class CollaborationOptimizer:
    """
    協作優化器 - 優化多Agent之間的協作效率
    """
    
    def __init__(self):
        self.communication_optimizer = CommunicationOptimizer()
        self.task_allocator = AdaptiveTaskAllocator()
        self.coordination_learner = CoordinationLearner()
        
    def optimize_collaboration(
        self,
        workflow_id: str,
        optimization_target: str = 'latency'
    ) -> CollaborationOptimizationResult:
        """
        優化特定工作流的協作效率
        """
        # 1. 分析當前協作模式
        current_pattern = self._analyze_current_collaboration(workflow_id)
        
        # 2. 識別瓶頸
        bottlenecks = self._identify_bottlenecks(current_pattern)
        
        # 3. 優化通信模式
        communication_improvements = self.communication_optimizer.optimize(
            current_pattern, bottlenecks
        )
        
        # 4. 優化任務分配
        allocation_improvements = self.task_allocator.optimize(
            current_pattern, optimization_target
        )
        
        # 5. 優化協調機制
        coordination_improvements = self.coordination_learner.optimize(
            current_pattern
        )
        
        # 6. 生成優化方案
        optimization_plan = self._synthesize_optimization_plan(
            communication_improvements,
            allocation_improvements,
            coordination_improvements
        )
        
        return CollaborationOptimizationResult(
            workflow_id=workflow_id,
            bottlenecks_identified=bottlenecks,
            optimizations_suggested=optimization_plan,
            expected_improvement=self._estimate_improvement(optimization_plan),
            implementation_roadmap=self._create_roadmap(optimization_plan)
        )
        
    class CommunicationOptimizer:
        """
        通信優化器 - 優化Agent間的通信效率
        """
        
        def optimize(
            self,
            collaboration_pattern: CollaborationPattern,
            bottlenecks: List[Bottleneck]
        ) -> List[CommunicationImprovement]:
            """
            優化通信模式
            """
            improvements = []
            
            # 1. 分析通信頻率和內容冗餘
            redundancy_analysis = self._analyze_redundancy(collaboration_pattern)
            
            if redundancy_analysis['high_redundancy']:
                # 建議使用摘要機制
                improvements.append(CommunicationImprovement(
                    improvement_type='message_summarization',
                    target='reduce_redundancy',
                    implementation='add_summary_layer',
                    expected_reduction=redundancy_analysis['redundancy_ratio']
                ))
                
            # 2. 分析通信延遲
            latency_analysis = self._analyze_latency(collaboration_pattern)
            
            if latency_analysis['high_latency']:
                # 建議使用異步通信或批處理
                improvements.append(CommunicationImprovement(
                    improvement_type='async_batching',
                    target='reduce_latency',
                    implementation='batch_non_urgent_messages',
                    expected_reduction=latency_analysis['latency_reduction_potential']
                ))
                
            # 3. 分析通信內容相關性
            relevance_analysis = self._analyze_relevance(collaboration_pattern)
            
            if relevance_analysis['low_relevance']:
                # 建議使用智能路由
                improvements.append(CommunicationImprovement(
                    improvement_type='smart_routing',
                    target='increase_relevance',
                    implementation='add_relevance_filter',
                    expected_improvement=relevance_analysis['improvement_potential']
                ))
                
            return improvements
            
    class AdaptiveTaskAllocator:
        """
        自適應任務分配器 - 動態優化任務分配
        """
        
        def __init__(self):
            self.agent_capabilities = {}
            self.workload_tracker = WorkloadTracker()
            
        def optimize(
            self,
            collaboration_pattern: CollaborationPattern,
            optimization_target: str
        ) -> List[AllocationImprovement]:
            """
            優化任務分配
            """
            improvements = []
            
            # 1. 分析當前分配效率
            current_efficiency = self._analyze_allocation_efficiency(
                collaboration_pattern
            )
            
            # 2. 識別負載不均衡
            workload_imbalance = self._analyze_workload_imbalance(
                collaboration_pattern
            )
            
            if workload_imbalance['is_imbalanced']:
                # 建議重新平衡負載
                improvements.append(AllocationImprovement(
                    improvement_type='workload_rebalancing',
                    target='balance_load',
                    current_distribution=workload_imbalance['current_distribution'],
                    proposed_distribution=workload_imbalance['optimal_distribution'],
                    expected_improvement=workload_imbalance['improvement_potential']
                ))
                
            # 3. 分析專長匹配度
            expertise_match = self._analyze_expertise_matching(collaboration_pattern)
            
            if expertise_match['low_match']:
                # 建議基於專長的任務分配
                improvements.append(AllocationImprovement(
                    improvement_type='expertise_based_allocation',
                    target='improve_quality',
                    current_match_score=expertise_match['current_score'],
                    potential_match_score=expertise_match['potential_score'],
                    expected_improvement=expertise_match['quality_improvement']
                ))
                
            # 4. 分析任務粒度
            granularity_analysis = self._analyze_task_granularity(
                collaboration_pattern
            )
            
            if granularity_analysis['suboptimal']:
                # 建議調整任務粒度
                improvements.append(AllocationImprovement(
                    improvement_type='task_granularity_adjustment',
                    target='reduce_overhead',
                    current_granularity=granularity_analysis['current'],
                    proposed_granularity=granularity_analysis['optimal'],
                    expected_improvement=granularity_analysis['overhead_reduction']
                ))
                
            return improvements
            
        def allocate_task(
            self,
            task: Task,
            available_agents: List[Agent],
            allocation_strategy: str = 'optimal'
        ) -> TaskAllocation:
            """
            分配任務給最合適的Agent
            """
            if allocation_strategy == 'optimal':
                return self._optimal_allocation(task, available_agents)
            elif allocation_strategy == 'load_balanced':
                return self._load_balanced_allocation(task, available_agents)
            elif allocation_strategy == 'expertise_first':
                return self._expertise_first_allocation(task, available_agents)
            else:
                raise ValueError(f"Unknown strategy: {allocation_strategy}")
                
        def _optimal_allocation(
            self,
            task: Task,
            available_agents: List[Agent]
        ) -> TaskAllocation:
            """
            使用多目標優化進行任務分配
            """
            best_score = -float('inf')
            best_agent = None
            
            for agent in available_agents:
                # 計算多維度分數
                scores = {
                    'expertise': self._calculate_expertise_score(agent, task),
                    'availability': self._calculate_availability_score(agent),
                    'workload': self._calculate_workload_score(agent),
                    'historical_performance': self._calculate_performance_score(agent, task),
                    'communication_cost': self._calculate_communication_cost(agent, task)
                }
                
                # 加權組合
                weights = {
                    'expertise': 0.35,
                    'availability': 0.2,
                    'workload': 0.2,
                    'historical_performance': 0.15,
                    'communication_cost': 0.1
                }
                
                total_score = sum(
                    scores[k] * weights[k] for k in weights.keys()
                )
                
                if total_score > best_score:
                    best_score = total_score
                    best_agent = agent
                    
            return TaskAllocation(
                task_id=task.id,
                assigned_agent=best_agent,
                allocation_score=best_score,
                score_breakdown=scores,
                confidence=self._calculate_allocation_confidence(
                    best_agent, task, scores
                )
            )
```

### 4.3 錯誤模式識別與修正

```python
class ErrorPatternDetector:
    """
    錯誤模式檢測器 - 識別和分析Agent的錯誤模式
    """
    
    def __init__(self):
        self.error_classifier = ErrorClassifier()
        self.pattern_miner = ErrorPatternMiner()
        self.root_cause_analyzer = RootCauseAnalyzer()
        
    def detect_error_patterns(
        self,
        agent_id: str = None,
        time_window_days: int = 30
    ) -> ErrorPatternReport:
        """
        檢測錯誤模式
        """
        # 1. 收集錯誤數據
        errors = self._collect_errors(agent_id, time_window_days)
        
        # 2. 分類錯誤
        classified_errors = self.error_classifier.classify(errors)
        
        # 3. 挖掘錯誤模式
        error_patterns = self.pattern_miner.mine(classified_errors)
        
        # 4. 分析根本原因
        for pattern in error_patterns:
            pattern.root_causes = self.root_cause_analyzer.analyze(pattern)
            
        # 5. 評估影響
        impact_assessment = self._assess_impact(error_patterns)
        
        return ErrorPatternReport(
            total_errors=len(errors),
            error_types_distribution=self._get_type_distribution(classified_errors),
            patterns_identified=error_patterns,
            high_impact_patterns=[p for p in error_patterns if p.impact_score > 0.7],
            recurring_patterns=[p for p in error_patterns if p.recurrence_rate > 0.3],
            root_cause_summary=self._summarize_root_causes(error_patterns),
            recommended_actions=self._generate_recommendations(error_patterns)
        )
        
    class ErrorClassifier:
        """
        錯誤分類器 - 將錯誤分類到不同類別
        """
        
        ERROR_CATEGORIES = {
            'knowledge_gap': {
                'description': '知識不足導致的錯誤',
                'severity': 'high',
                'examples': ['提供了過時信息', '遺漏關鍵知識點']
            },
            'reasoning_error': {
                'description': '推理過程中的錯誤',
                'severity': 'high',
                'examples': ['邏輯錯誤', '因果關係錯誤']
            },
            'context_misunderstanding': {
                'description': '對用戶情境的誤解',
                'severity': 'medium',
                'examples': ['忽視用戶約束', '錯誤解讀用戶意圖']
            },
            'personalization_failure': {
                'description': '個性化失敗',
                'severity': 'medium',
                'examples': ['不符合用戶偏好', '忽視用戶歷史']
            },
            'coordination_error': {
                'description': 'Agent協作錯誤',
                'severity': 'medium',
                'examples': ['信息傳遞錯誤', '任務分配不當']
            },
            'timing_error': {
                'description': '時機選擇錯誤',
                'severity': 'low',
                'examples': ['建議時機不當', '頻率不合適']
            }
        }
        
        def classify(self, errors: List[Error]) -> List[ClassifiedError]:
            """
            使用LLM和規則結合的方式分類錯誤
            """
            classified = []
            
            for error in errors:
                # 規則分類
                rule_based = self._rule_based_classification(error)
                
                # LLM分類
                llm_based = self._llm_classification(error)
                
                # 結合兩種方法
                final_category = self._combine_classifications(
                    rule_based, llm_based
                )
                
                classified.append(ClassifiedError(
                    original_error=error,
                    category=final_category,
                    confidence=self._calculate_classification_confidence(
                        rule_based, llm_based
                    ),
                    severity=self.ERROR_CATEGORIES[final_category]['severity']
                ))
                
            return classified
            
    class ErrorPatternMiner:
        """
        錯誤模式挖掘器 - 發現錯誤的規律性模式
        """
        
        def mine(
            self,
            classified_errors: List[ClassifiedError]
        ) -> List[ErrorPattern]:
            """
            挖掘錯誤模式
            """
            patterns = []
            
            # 1. 時間模式
            temporal_patterns = self._mine_temporal_patterns(classified_errors)
            patterns.extend(temporal_patterns)
            
            # 2. 情境模式
            contextual_patterns = self._mine_contextual_patterns(classified_errors)
            patterns.extend(contextual_patterns)
            
            # 3. 序列模式
            sequential_patterns = self._mine_sequential_patterns(classified_errors)
            patterns.extend(sequential_patterns)
            
            # 4. Agent相關模式
            agent_patterns = self._mine_agent_patterns(classified_errors)
            patterns.extend(agent_patterns)
            
            return patterns
            
        def _mine_temporal_patterns(
            self,
            errors: List[ClassifiedError]
        ) -> List[ErrorPattern]:
            """
            挖掘時間相關的錯誤模式
            """
            patterns = []
            
            # 按時間聚合錯誤
            error_times = [e.original_error.timestamp for e in errors]
            
            # 檢測錯誤高峰時段
            hourly_distribution = defaultdict(int)
            for t in error_times:
                hourly_distribution[t.hour] += 1
                
            # 找到異常高峰
            mean_errors = np.mean(list(hourly_distribution.values()))
            std_errors = np.std(list(hourly_distribution.values()))
            
            for hour, count in hourly_distribution.items():
                if count > mean_errors + 2 * std_errors:
                    patterns.append(ErrorPattern(
                        pattern_type='temporal_spike',
                        description=f'錯誤在 {hour}:00 時段顯著增加',
                        frequency=count / len(errors),
                        affected_errors=[e for e in errors 
                                       if e.original_error.timestamp.hour == hour],
                        confidence=self._calculate_temporal_confidence(
                            count, mean_errors, std_errors
                        )
                    ))
                    
            # 檢測錯誤增長趨勢
            daily_counts = self._aggregate_daily(errors)
            if len(daily_counts) > 7:
                trend = self._calculate_trend(daily_counts)
                if trend['slope'] > 0 and trend['p_value'] < 0.05:
                    patterns.append(ErrorPattern(
                        pattern_type='increasing_trend',
                        description='錯誤率呈上升趨勢',
                        frequency=trend['slope'],
                        affected_errors=errors,
                        confidence=1 - trend['p_value']
                    ))
                    
            return patterns
            
class ErrorCorrectionEngine:
    """
    錯誤修正引擎 - 自動修正識別到的錯誤模式
    """
    
    def __init__(self):
        self.correction_strategies = CorrectionStrategyLibrary()
        self.effectiveness_tracker = CorrectionEffectivenessTracker()
        
    def generate_corrections(
        self,
        error_patterns: List[ErrorPattern]
    ) -> List[CorrectionPlan]:
        """
        為錯誤模式生成修正方案
        """
        corrections = []
        
        for pattern in error_patterns:
            # 根據錯誤類型選擇修正策略
            strategy = self.correction_strategies.get_strategy(
                pattern.category,
                pattern.root_causes
            )
            
            # 生成具體修正方案
            correction_plan = strategy.generate_plan(pattern)
            
            # 評估修正效果預期
            expected_effectiveness = self._predict_effectiveness(
                correction_plan, pattern
            )
            
            corrections.append(CorrectionPlan(
                pattern=pattern,
                correction_strategy=strategy,
                implementation_steps=correction_plan,
                expected_effectiveness=expected_effectiveness,
                risk_assessment=self._assess_risk(correction_plan),
                rollback_plan=self._create_rollback_plan(correction_plan)
            ))
            
        # 按預期效果排序
        corrections.sort(
            key=lambda x: x.expected_effectiveness,
            reverse=True
        )
        
        return corrections
        
    def apply_correction(
        self,
        correction_plan: CorrectionPlan,
        apply_mode: str = 'gradual'
    ) -> CorrectionResult:
        """
        應用修正方案
        """
        if apply_mode == 'gradual':
            return self._gradual_application(correction_plan)
        elif apply_mode == 'immediate':
            return self._immediate_application(correction_plan)
        elif apply_mode == 'a_b_test':
            return self._ab_test_application(correction_plan)
        else:
            raise ValueError(f"Unknown mode: {apply_mode}")
            
    def _gradual_application(
        self,
        correction_plan: CorrectionPlan
    ) -> CorrectionResult:
        """
        漸進式應用修正
        """
        # 1. 選擇小規模測試群體
        test_group = self._select_test_group(size=100)
        
        # 2. 應用修正
        self._apply_to_group(correction_plan, test_group)
        
        # 3. 監控效果
        monitoring_period = timedelta(days=7)
        effectiveness = self._monitor_effectiveness(
            correction_plan, test_group, monitoring_period
        )
        
        # 4. 決定是否擴大應用
        if effectiveness > 0.7:
            # 擴大到更大群體
            larger_group = self._select_test_group(size=1000)
            self._apply_to_group(correction_plan, larger_group)
            
            # 繼續監控
            effectiveness = self._monitor_effectiveness(
                correction_plan, larger_group, monitoring_period
            )
            
            if effectiveness > 0.8:
                # 全面應用
                self._apply_globally(correction_plan)
                status = 'fully_deployed'
            else:
                status = 'partially_deployed'
        else:
            # 效果不佳，回滾
            self._rollback(correction_plan, test_group)
            status = 'rolled_back'
            
        return CorrectionResult(
            correction_plan=correction_plan,
            application_mode='gradual',
            final_status=status,
            effectiveness_measured=effectiveness,
            sample_sizes={'initial': 100, 'expanded': 1000},
            lessons_learned=self._extract_lessons(correction_plan, status)
        )
```

### 4.4 效能監控與自動調整

```python
class PerformanceMonitor:
    """
    效能監控器 - 持續監控系統效能
    """
    
    def __init__(self):
        self.metrics_collector = MetricsCollector()
        self.anomaly_detector = PerformanceAnomalyDetector()
        self.alert_manager = AlertManager()
        
    METRICS_DEFINITION = {
        # 系統層面指標
        'system': {
            'response_time': {
                'type': 'latency',
                'threshold_p95': 2000,  # ms
                'alert_threshold': 3000
            },
            'throughput': {
                'type': 'rate',
                'target': 1000,  # requests/min
                'alert_threshold': 500
            },
            'error_rate': {
                'type': 'percentage',
                'threshold': 0.01,  # 1%
                'alert_threshold': 0.05
            },
            'resource_utilization': {
                'type': 'percentage',
                'cpu_threshold': 0.8,
                'memory_threshold': 0.85
            }
        },
        
        # Agent層面指標
        'agent': {
            'decision_quality': {
                'type': 'score',
                'target': 0.85,
                'alert_threshold': 0.7
            },
            'task_completion_rate': {
                'type': 'percentage',
                'target': 0.95,
                'alert_threshold': 0.85
            },
            'user_satisfaction': {
                'type': 'rating',
                'target': 4.0,  # 5分制
                'alert_threshold': 3.5
            }
        },
        
        # 業務層面指標
        'business': {
            'user_retention': {
                'type': 'percentage',
                'target': 0.8,
                'alert_threshold': 0.6
            },
            'goal_achievement_rate': {
                'type': 'percentage',
                'target': 0.7,
                'alert_threshold': 0.5
            },
            'recommendation_adoption': {
                'type': 'percentage',
                'target': 0.6,
                'alert_threshold': 0.4
            }
        }
    }
    
    def monitor(self, monitoring_scope: str = 'all') -> MonitoringReport:
        """
        執行效能監控
        """
        report = MonitoringReport(timestamp=datetime.now())
        
        # 1. 收集指標
        if monitoring_scope in ['all', 'system']:
            report.system_metrics = self._collect_system_metrics()
            
        if monitoring_scope in ['all', 'agent']:
            report.agent_metrics = self._collect_agent_metrics()
            
        if monitoring_scope in ['all', 'business']:
            report.business_metrics = self._collect_business_metrics()
            
        # 2. 檢測異常
        anomalies = self.anomaly_detector.detect(report)
        report.anomalies = anomalies
        
        # 3. 生成警報
        if anomalies:
            alerts = self.alert_manager.generate_alerts(anomalies)
            report.alerts = alerts
            
        # 4. 趨勢分析
        report.trends = self._analyze_trends(report)
        
        # 5. 生成建議
        report.recommendations = self._generate_recommendations(report)
        
        return report
        
    class PerformanceAnomalyDetector:
        """
        效能異常檢測器 - 使用多種方法檢測異常
        """
        
        def __init__(self):
            self.methods = {
                'statistical': StatisticalAnomalyDetector(),
                'ml_based': MLAnomalyDetector(),
                'rule_based': RuleBasedAnomalyDetector()
            }
            
        def detect(self, report: MonitoringReport) -> List[Anomaly]:
            """
            使用多種方法檢測異常
            """
            all_anomalies = []
            
            # 統計方法
            statistical_anomalies = self.methods['statistical'].detect(report)
            all_anomalies.extend(statistical_anomalies)
            
            # 機器學習方法
            ml_anomalies = self.methods['ml_based'].detect(report)
            all_anomalies.extend(ml_anomalies)
            
            # 規則方法
            rule_anomalies = self.methods['rule_based'].detect(report)
            all_anomalies.extend(rule_anomalies)
            
            # 合併重複檢測
            merged_anomalies = self._merge_duplicates(all_anomalies)
            
            # 按嚴重性排序
            merged_anomalies.sort(key=lambda x: x.severity, reverse=True)
            
            return merged_anomalies
            
        class MLAnomalyDetector:
            """
            基於機器學習的異常檢測
            """
            
            def __init__(self):
                self.isolation_forest = IsolationForest(
                    contamination=0.1,
                    random_state=42
                )
                self.lstm_autoencoder = None  # 用於時間序列
                
            def detect(self, report: MonitoringReport) -> List[Anomaly]:
                """
                使用多種ML方法檢測異常
                """
                anomalies = []
                
                # 1. 使用Isolation Forest檢測點異常
                point_anomalies = self._detect_point_anomalies(report)
                anomalies.extend(point_anomalies)
                
                # 2. 使用LSTM Autoencoder檢測序列異常
                sequence_anomalies = self._detect_sequence_anomalies(report)
                anomalies.extend(sequence_anomalies)
                
                return anomalies
                
            def _detect_point_anomalies(
                self,
                report: MonitoringReport
            ) -> List[Anomaly]:
                """
                使用Isolation Forest檢測點異常
                """
                # 準備特徵
                features = self._extract_features(report)
                
                # 訓練/預測
                predictions = self.isolation_forest.fit_predict(features)
                scores = self.isolation_forest.score_samples(features)
                
                anomalies = []
                for i, (pred, score) in enumerate(zip(predictions, scores)):
                    if pred == -1:  # 異常
                        anomaly = Anomaly(
                            anomaly_type='point_anomaly',
                            metric=self._get_metric_name(i),
                            detected_value=features[i],
                            anomaly_score=-score,
                            severity=self._calculate_severity(-score),
                            detection_method='isolation_forest'
                        )
                        anomalies.append(anomaly)
                        
                return anomalies

class AutoAdjustmentEngine:
    """
    自動調整引擎 - 根據監控結果自動調整系統
    """
    
    def __init__(self):
        self.adjustment_policies = AdjustmentPolicyLibrary()
        self.impact_predictor = AdjustmentImpactPredictor()
        
    def evaluate_adjustments(
        self,
        monitoring_report: MonitoringReport
    ) -> List[AdjustmentRecommendation]:
        """
        評估需要的調整
        """
        recommendations = []
        
        # 1. 分析每個異常
        for anomaly in monitoring_report.anomalies:
            # 查找適用的調整策略
            policies = self.adjustment_policies.find_applicable(anomaly)
            
            for policy in policies:
                # 預測調整效果
                predicted_impact = self.impact_predictor.predict(
                    policy, anomaly
                )
                
                # 評估風險收益
                risk_benefit = self._assess_risk_benefit(
                    policy, predicted_impact
                )
                
                if risk_benefit['score'] > 0.6:
                    recommendations.append(AdjustmentRecommendation(
                        target_anomaly=anomaly,
                        adjustment_policy=policy,
                        predicted_impact=predicted_impact,
                        risk_assessment=risk_benefit,
                        confidence=self._calculate_confidence(
                            policy, predicted_impact
                        ),
                        implementation_plan=self._create_implementation_plan(policy)
                    ))
                    
        # 按風險收益排序
        recommendations.sort(
            key=lambda x: x.risk_assessment['score'],
            reverse=True
        )
        
        return recommendations
        
    def execute_adjustment(
        self,
        recommendation: AdjustmentRecommendation,
        execution_mode: str = 'automatic'
    ) -> AdjustmentResult:
        """
        執行調整
        """
        if execution_mode == 'automatic':
            # 自動執行（低風險調整）
            if recommendation.risk_assessment['risk_level'] == 'low':
                return self._automatic_execution(recommendation)
            else:
                # 高風險調整需要人工確認
                return self._request_human_approval(recommendation)
                
        elif execution_mode == 'assisted':
            # 輔助模式 - 提供建議但需人工確認
            return self._assisted_execution(recommendation)
            
        elif execution_mode == 'manual':
            # 完全手動
            return self._manual_execution(recommendation)
            
    def _automatic_execution(
        self,
        recommendation: AdjustmentRecommendation
    ) -> AdjustmentResult:
        """
        自動執行調整
        """
        policy = recommendation.adjustment_policy
        
        # 1. 創建備份
        backup = self._create_backup()
        
        try:
            # 2. 執行調整
            execution_result = policy.execute()
            
            # 3. 驗證效果
            verification = self._verify_adjustment(
                recommendation, execution_result
            )
            
            # 4. 如果效果不佳，回滾
            if not verification.success:
                self._rollback(backup)
                status = 'rolled_back'
            else:
                status = 'success'
                
            return AdjustmentResult(
                recommendation=recommendation,
                execution_result=execution_result,
                verification=verification,
                status=status,
                backup_reference=backup.id
            )
            
        except Exception as e:
            # 發生異常，回滾
            self._rollback(backup)
            return AdjustmentResult(
                recommendation=recommendation,
                execution_result=None,
                verification=None,
                status='failed',
                error=str(e),
                backup_reference=backup.id
            )
```

---

## 5. 進化效果衡量

### 5.1 關鍵指標定義

```python
class EvolutionMetricsFramework:
    """
    進化效果衡量框架 - 定義和計算進化相關指標
    """
    
    # 核心指標定義
    CORE_METRICS = {
        # 用戶滿意度指標
        'user_satisfaction': {
            'description': '用戶對系統的整體滿意度',
            'measurement_method': 'survey + implicit_signals',
            'frequency': 'weekly',
            'target': 4.2,  # 5分制
            'alert_threshold': 3.5,
            'components': {
                'explicit_rating': {
                    'weight': 0.4,
                    'source': 'user_surveys'
                },
                'nps_score': {
                    'weight': 0.3,
                    'source': 'nps_surveys'
                },
                'implicit_satisfaction': {
                    'weight': 0.3,
                    'source': 'behavior_analysis'
                }
            }
        },
        
        # 建議採納率
        'recommendation_adoption_rate': {
            'description': '用戶採納系統建議的比例',
            'measurement_method': 'action_tracking',
            'frequency': 'daily',
            'target': 0.65,
            'alert_threshold': 0.45,
            'calculation': 'adopted_recommendations / total_recommendations'
        },
        
        # 建議完成率
        'recommendation_completion_rate': {
            'description': '用戶完成建議行動的比例',
            'measurement_method': 'progress_tracking',
            'frequency': 'daily',
            'target': 0.75,
            'alert_threshold': 0.55,
            'calculation': 'completed_actions / adopted_recommendations'
        },
        
        # 目標達成率
        'goal_achievement_rate': {
            'description': '用戶達成設定目標的比例',
            'measurement_method': 'goal_tracking',
            'frequency': 'weekly',
            'target': 0.70,
            'alert_threshold': 0.50,
            'levels': {
                'short_term': {'horizon': '1_week', 'target': 0.80},
                'medium_term': {'horizon': '1_month', 'target': 0.70},
                'long_term': {'horizon': '3_months', 'target': 0.60}
            }
        },
        
        # KBI改善率
        'kbi_improvement_rate': {
            'description': '關鍵行為指標的改善程度',
            'measurement_method': 'kbi_tracking',
            'frequency': 'weekly',
            'target': 0.15,  # 15%改善
            'alert_threshold': 0.0,
            'kbis': [
                'sleep_quality',
                'exercise_frequency',
                'nutrition_quality',
                'stress_level',
                'social_connection'
            ]
        },
        
        # 個人化準確性
        'personalization_accuracy': {
            'description': '系統對用戶偏好和需求的預測準確性',
            'measurement_method': 'prediction_validation',
            'frequency': 'weekly',
            'target': 0.80,
            'alert_threshold': 0.65,
            'components': {
                'preference_prediction': 0.3,
                'behavior_prediction': 0.3,
                'need_prediction': 0.4
            }
        },
        
        # 互動效率
        'interaction_efficiency': {
            'description': '達成目標所需的互動次數',
            'measurement_method': 'interaction_tracking',
            'frequency': 'weekly',
            'target': 5.0,  # 平均5次互動達成目標
            'alert_threshold': 10.0,
            'lower_is_better': True
        },
        
        # 系統信任度
        'system_trust': {
            'description': '用戶對系統的信任程度',
            'measurement_method': 'trust_survey + behavior_proxy',
            'frequency': 'monthly',
            'target': 4.0,  # 5分制
            'alert_threshold': 3.0,
            'behavior_proxies': [
                'data_sharing_willingness',
                'notification_response_rate',
                'feature_exploration_depth'
            ]
        },
        
        # 長期留存率
        'long_term_retention': {
            'description': '用戶長期使用系統的比例',
            'measurement_method': 'cohort_analysis',
            'frequency': 'monthly',
            'target': 0.75,  # 6個月留存率
            'alert_threshold': 0.50,
            'cohorts': ['1_month', '3_months', '6_months', '12_months']
        }
    }
    
    def calculate_comprehensive_score(
        self,
        user_id: str = None,
        time_window_days: int = 30
    ) -> EvolutionScore:
        """
        計算綜合進化分數
        """
        scores = {}
        
        for metric_name, metric_config in self.CORE_METRICS.items():
            score = self._calculate_metric(
                metric_name,
                metric_config,
                user_id,
                time_window_days
            )
            scores[metric_name] = score
            
        # 計算加權總分
        weights = self._get_metric_weights()
        overall_score = sum(
            scores[k].normalized_value * weights[k]
            for k in scores.keys()
        )
        
        # 計算趨勢
        trends = self._calculate_trends(scores, time_window_days)
        
        return EvolutionScore(
            overall_score=overall_score,
            component_scores=scores,
            trends=trends,
            benchmark_comparison=self._compare_to_benchmark(scores),
            improvement_areas=self._identify_improvement_areas(scores),
            confidence_interval=self._calculate_confidence_interval(scores)
        )
        
    def _calculate_metric(
        self,
        metric_name: str,
        metric_config: Dict,
        user_id: str,
        days: int
    ) -> MetricScore:
        """
        計算單個指標的分數
        """
        if metric_name == 'user_satisfaction':
            return self._calculate_satisfaction_score(user_id, days, metric_config)
        elif metric_name == 'recommendation_adoption_rate':
            return self._calculate_adoption_rate(user_id, days, metric_config)
        elif metric_name == 'goal_achievement_rate':
            return self._calculate_goal_achievement(user_id, days, metric_config)
        elif metric_name == 'personalization_accuracy':
            return self._calculate_personalization_accuracy(user_id, days, metric_config)
        # ... 其他指標
        else:
            raise ValueError(f"Unknown metric: {metric_name}")
            
    def _calculate_satisfaction_score(
        self,
        user_id: str,
        days: int,
        config: Dict
    ) -> MetricScore:
        """
        計算用戶滿意度分數
        """
        # 收集各組成部分的數據
        components = {}
        
        # 顯性評分
        explicit_ratings = self._get_explicit_ratings(user_id, days)
        if explicit_ratings:
            components['explicit_rating'] = np.mean(explicit_ratings)
        else:
            components['explicit_rating'] = None
            
        # NPS分數
        nps_scores = self._get_nps_scores(user_id, days)
        if nps_scores:
            components['nps_score'] = self._calculate_nps(nps_scores)
        else:
            components['nps_score'] = None
            
        # 隱性滿意度
        implicit = self._calculate_implicit_satisfaction(user_id, days)
        components['implicit_satisfaction'] = implicit
        
        # 加權組合
        available_components = {
            k: v for k, v in components.items() if v is not None
        }
        
        if not available_components:
            return MetricScore(
                value=None,
                normalized_value=0.5,
                confidence=0.0,
                status='insufficient_data'
            )
            
        # 重新加權
        total_weight = sum(
            config['components'][k]['weight']
            for k in available_components.keys()
        )
        
        weighted_score = sum(
            v * config['components'][k]['weight'] / total_weight
            for k, v in available_components.items()
        )
        
        # 標準化到0-1
        normalized = weighted_score / 5.0
        
        # 計算置信度
        confidence = len(available_components) / len(config['components'])
        
        return MetricScore(
            value=weighted_score,
            normalized_value=normalized,
            confidence=confidence,
            status=self._determine_status(normalized, config),
            component_breakdown=components
        )
        
    def _calculate_implicit_satisfaction(
        self,
        user_id: str,
        days: int
    ) -> float:
        """
        從行為信號計算隱性滿意度
        """
        signals = []
        
        # 1. 參與頻率
        engagement_freq = self._calculate_engagement_frequency(user_id, days)
        signals.append(engagement_freq)
        
        # 2. 功能探索深度
        exploration_depth = self._calculate_exploration_depth(user_id, days)
        signals.append(exploration_depth)
        
        # 3. 主動互動比例
        proactive_ratio = self._calculate_proactive_ratio(user_id, days)
        signals.append(proactive_ratio)
        
        # 4. 會話長度趨勢
        session_trend = self._calculate_session_trend(user_id, days)
        signals.append(session_trend)
        
        # 5. 負面行為（減分項）
        negative_signals = self._calculate_negative_signals(user_id, days)
        
        # 組合信號
        satisfaction = np.mean(signals) * (1 - negative_signals)
        
        # 標準化到1-5分
        return 1 + 4 * satisfaction
```

### 5.2 進化速度的衡量

```python
class EvolutionVelocityMetrics:
    """
    進化速度指標 - 衡量系統學習和改進的速度
    """
    
    def calculate_evolution_velocity(
        self,
        metric_name: str,
        time_periods: List[Tuple[datetime, datetime]]
    ) -> EvolutionVelocity:
        """
        計算特定指標的進化速度
        """
        # 獲取各時間段的指標值
        period_values = []
        for start, end in time_periods:
            value = self._get_metric_value(metric_name, start, end)
            period_values.append({
                'period': (start, end),
                'value': value
            })
            
        # 計算變化率
        changes = []
        for i in range(1, len(period_values)):
            prev_value = period_values[i-1]['value']
            curr_value = period_values[i]['value']
            
            if prev_value and curr_value and prev_value > 0:
                change_rate = (curr_value - prev_value) / prev_value
                changes.append({
                    'period': period_values[i]['period'],
                    'change_rate': change_rate,
                    'absolute_change': curr_value - prev_value
                })
                
        # 計算平均進化速度
        if changes:
            avg_velocity = np.mean([c['change_rate'] for c in changes])
            velocity_trend = self._calculate_velocity_trend(changes)
        else:
            avg_velocity = 0
            velocity_trend = 'stable'
            
        # 計算加速/減速
        acceleration = self._calculate_acceleration(changes)
        
        return EvolutionVelocity(
            metric_name=metric_name,
            average_velocity=avg_velocity,
            velocity_trend=velocity_trend,
            acceleration=acceleration,
            period_changes=changes,
            comparison_to_target=self._compare_to_target_velocity(
                metric_name, avg_velocity
            )
        )
        
    def calculate_learning_curve(
        self,
        user_id: str,
        metric_name: str,
        learning_phases: List[str] = None
    ) -> LearningCurve:
        """
        計算學習曲線
        """
        if learning_phases is None:
            learning_phases = ['onboarding', 'habituation', 'optimization', 'mastery']
            
        # 獲取用戶全歷史數據
        user_history = self._get_user_history(user_id, metric_name)
        
        # 識別學習階段
        phases = self._identify_learning_phases(user_history, learning_phases)
        
        # 計算每個階段的學習速率
        phase_velocities = {}
        for phase_name, phase_data in phases.items():
            if len(phase_data) > 1:
                velocity = self._calculate_phase_velocity(phase_data)
                phase_velocities[phase_name] = velocity
                
        # 擬合學習曲線模型
        curve_model = self._fit_learning_curve(user_history)
        
        # 預測未來表現
        future_projection = self._project_future_performance(
            curve_model, phases
        )
        
        return LearningCurve(
            user_id=user_id,
            metric_name=metric_name,
            phases=phases,
            phase_velocities=phase_velocities,
            curve_model=curve_model,
            future_projection=future_projection,
            time_to_mastery=self._estimate_time_to_mastery(curve_model),
            plateau_detection=self._detect_plateaus(user_history)
        )
        
    def _fit_learning_curve(
        self,
        user_history: List[MetricObservation]
    ) -> LearningCurveModel:
        """
        擬合學習曲線模型
        
        使用指數學習曲線: y = a - b * e^(-c * x)
        """
        from scipy.optimize import curve_fit
        
        # 準備數據
        x = np.array([i for i in range(len(user_history))])
        y = np.array([obs.value for obs in user_history])
        
        # 定義學習曲線函數
        def learning_curve(x, a, b, c):
            return a - b * np.exp(-c * x)
            
        # 擬合參數
        try:
            params, covariance = curve_fit(learning_curve, x, y, 
                                          p0=[y.max(), y.max() - y.min(), 0.1],
                                          maxfev=10000)
            a, b, c = params
            
            # 計算擬合優度
            y_pred = learning_curve(x, *params)
            r_squared = 1 - np.sum((y - y_pred) ** 2) / np.sum((y - y.mean()) ** 2)
            
            return LearningCurveModel(
                model_type='exponential',
                parameters={'a': a, 'b': b, 'c': c},
                asymptote=a,  # 理論上限
                learning_rate=c,  # 學習速率
                r_squared=r_squared,
                fit_quality='good' if r_squared > 0.7 else 'moderate' if r_squared > 0.5 else 'poor'
            )
        except:
            # 擬合失敗，使用線性模型
            slope, intercept, r_value, p_value, std_err = linregress(x, y)
            return LearningCurveModel(
                model_type='linear',
                parameters={'slope': slope, 'intercept': intercept},
                asymptote=None,
                learning_rate=slope,
                r_squared=r_value ** 2,
                fit_quality='fallback_linear'
            )
```

### 5.3 長期價值評估框架

```python
class LongTermValueAssessment:
    """
    長期價值評估框架 - 評估系統的長期用戶價值
    """
    
    def calculate_ltv_components(
        self,
        user_id: str,
        projection_years: int = 3
    ) -> LTVAssessment:
        """
        計算用戶長期價值組成
        """
        # 1. 計算歷史價值
        historical_value = self._calculate_historical_value(user_id)
        
        # 2. 預測未來價值
        future_value = self._project_future_value(user_id, projection_years)
        
        # 3. 評估價值驅動因素
        value_drivers = self._identify_value_drivers(user_id)
        
        # 4. 評估風險因素
        risk_factors = self._assess_risk_factors(user_id)
        
        # 5. 計算綜合LTV
        total_ltv = self._calculate_total_ltv(
            historical_value, future_value, risk_factors
        )
        
        return LTVAssessment(
            user_id=user_id,
            historical_value=historical_value,
            projected_future_value=future_value,
            total_ltv=total_ltv,
            value_drivers=value_drivers,
            risk_factors=risk_factors,
            confidence_interval=self._calculate_ltv_confidence(
                historical_value, future_value, risk_factors
            ),
            optimization_opportunities=self._identify_optimization_opportunities(
                value_drivers, risk_factors
            )
        )
        
    def _project_future_value(
        self,
        user_id: str,
        years: int
    ) -> FutureValueProjection:
        """
        預測未來價值
        """
        # 獲取用戶歷史數據
        user_history = self._get_comprehensive_history(user_id)
        
        # 1. 預測留存概率
        retention_curve = self._project_retention(user_history, years)
        
        # 2. 預測參與度演變
        engagement_evolution = self._project_engagement(user_history, years)
        
        # 3. 預測目標達成價值
        goal_value = self._project_goal_value(user_history, years)
        
        # 4. 預測推薦價值
        referral_value = self._project_referral_value(user_history, years)
        
        # 5. 綜合計算
        yearly_projections = []
        for year in range(1, years + 1):
            year_value = (
                retention_curve[year] *
                engagement_evolution[year] *
                goal_value[year] +
                referral_value[year]
            )
            yearly_projections.append({
                'year': year,
                'projected_value': year_value,
                'retention_probability': retention_curve[year],
                'engagement_level': engagement_evolution[year]
            })
            
        return FutureValueProjection(
            projection_period_years=years,
            yearly_projections=yearly_projections,
            total_projected_value=sum(y['projected_value'] for y in yearly_projections),
            npv=self._calculate_npv(yearly_projections),
            key_assumptions={
                'retention_model': 'cohort_based',
                'engagement_model': 'learning_curve',
                'discount_rate': 0.1
            }
        )
        
    def _project_retention(
        self,
        user_history: UserHistory,
        years: int
    ) -> Dict[int, float]:
        """
        預測留存概率曲線
        """
        # 基於相似用戶群的留存數據
        similar_users = self._find_similar_users(user_history)
        
        # 計算留存曲線
        retention_by_month = self._calculate_cohort_retention(similar_users)
        
        # 擬合留存模型
        # 使用指數衰減模型: R(t) = a * e^(-b*t) + c
        months = np.array(list(retention_by_month.keys()))
        rates = np.array(list(retention_by_month.values()))
        
        def retention_model(t, a, b, c):
            return a * np.exp(-b * t) + c
            
        params, _ = curve_fit(retention_model, months, rates, 
                             p0=[0.8, 0.1, 0.2],
                             maxfev=10000)
        a, b, c = params
        
        # 預測未來留存
        projections = {}
        for year in range(1, years + 1):
            month = year * 12
            retention = retention_model(month, a, b, c)
            projections[year] = max(0, min(1, retention))
            
        return projections
        
    def calculate_system_evolution_roi(
        self,
        evolution_investments: List[EvolutionInvestment],
        time_horizon_months: int = 12
    ) -> EvolutionROI:
        """
        計算系統進化投資的ROI
        """
        # 1. 計算投資成本
        total_investment = sum(inv.cost for inv in evolution_investments)
        
        # 2. 計算收益
        benefits = self._calculate_evolution_benefits(
            evolution_investments, time_horizon_months
        )
        
        # 3. 計算各維度ROI
        roi_by_dimension = {}
        for dimension in ['user_satisfaction', 'retention', 'efficiency', 'quality']:
            dimension_investment = sum(
                inv.cost for inv in evolution_investments
                if inv.target_dimension == dimension
            )
            dimension_benefit = benefits.get(dimension, 0)
            
            if dimension_investment > 0:
                roi_by_dimension[dimension] = (
                    dimension_benefit - dimension_investment
                ) / dimension_investment
                
        # 4. 計算綜合ROI
        total_benefit = sum(benefits.values())
        overall_roi = (total_benefit - total_investment) / total_investment
        
        return EvolutionROI(
            total_investment=total_investment,
            total_benefit=total_benefit,
            overall_roi=overall_roi,
            roi_by_dimension=roi_by_dimension,
            payback_period_months=self._calculate_payback_period(
                evolution_investments, benefits
            ),
            break_even_analysis=self._break_even_analysis(
                total_investment, benefits
            ),
            sensitivity_analysis=self._sensitivity_analysis(
                evolution_investments, benefits
            )
        )
```

---

## 6. 技術實現方案

### 6.1 系統架構設計

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        自我進化機制系統架構                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        反饋收集層 (Feedback Layer)                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 顯性反饋收集  │  │ 隱性反饋收集  │  │ 結果追蹤     │              │   │
│  │  │ Collector    │  │ Collector    │  │ Tracker      │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        數據處理層 (Data Processing Layer)            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 數據清洗     │  │ 特徵工程     │  │ 模式識別     │              │   │
│  │  │ Cleaner      │  │ Engineer     │  │ Pattern Miner│              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        學習引擎層 (Learning Engine Layer)            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 用戶畫像學習  │  │ 偏好學習     │  │ 決策策略學習  │              │   │
│  │  │ Profile      │  │ Preference   │  │ Policy       │              │   │
│  │  │ Learner      │  │ Learner      │  │ Optimizer    │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 知識庫更新   │  │ Agent協作優化│  │ 錯誤修正     │              │   │
│  │  │ Knowledge    │  │ Collaboration│  │ Error        │              │   │
│  │  │ Updater      │  │ Optimizer    │  │ Corrector    │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        知識存儲層 (Knowledge Storage Layer)          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 用戶畫像存儲  │  │ 知識庫       │  │ 策略存儲     │              │   │
│  │  │ User Profile │  │ Knowledge    │  │ Policy       │              │   │
│  │  │ Store        │  │ Base         │  │ Store        │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 反饋歷史     │  │ 經驗回放     │  │ 模型版本     │              │   │
│  │  │ Feedback     │  │ Experience   │  │ Model        │              │   │
│  │  │ History      │  │ Replay       │  │ Versions     │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        監控評估層 (Monitoring Layer)                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 效能監控     │  │ 指標計算     │  │ A/B測試      │              │   │
│  │  │ Performance  │  │ Metrics      │  │ Framework    │              │   │
│  │  │ Monitor      │  │ Calculator   │  │              │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ 異常檢測     │  │ 自動調整     │  │ 報告生成     │              │   │
│  │  │ Anomaly      │  │ Auto         │  │ Reporting    │              │   │
│  │  │ Detection    │  │ Adjustment   │  │              │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 核心數據結構

```python
# ============================================================
# 核心數據結構定義
# ============================================================

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Union, Tuple
from datetime import datetime, timedelta
from enum import Enum
import numpy as np

# -----------------------------------------------------------
# 基礎枚舉類型
# -----------------------------------------------------------

class FeedbackType(Enum):
    EXPLICIT_RATING = "explicit_rating"
    EXPLICIT_CHOICE = "explicit_choice"
    EXPLICIT_TEXT = "explicit_text"
    IMPLICIT_ADOPTION = "implicit_adoption"
    IMPLICIT_ENGAGEMENT = "implicit_engagement"
    IMPLICIT_BEHAVIOR = "implicit_behavior"

class InterventionStatus(Enum):
    PENDING = "pending"
    DELIVERED = "delivered"
    ADOPTED = "adopted"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    IGNORED = "ignored"
    REJECTED = "rejected"

class KnowledgeLayer(Enum):
    THEORETICAL = "theoretical"
    CASE_STUDY = "case_study"
    COMMUNITY = "community"

class PatternType(Enum):
    SEQUENTIAL = "sequential"
    TEMPORAL = "temporal"
    CAUSAL = "causal"
    CONTEXTUAL = "contextual"

# -----------------------------------------------------------
# 反饋相關數據結構
# -----------------------------------------------------------

@dataclass
class FeedbackItem:
    """反饋項基類"""
    feedback_id: str
    user_id: str
    feedback_type: FeedbackType
    timestamp: datetime
    source: str  # 反饋來源
    confidence: float = 1.0
    
@dataclass
class ExplicitFeedback(FeedbackItem):
    """顯性反饋"""
    intervention_id: Optional[str]
    ratings: Dict[str, Union[int, float]] = field(default_factory=dict)
    choices: Dict[str, Union[str, List[str]]] = field(default_factory=dict)
    text_feedback: Optional[str] = None
    sentiment_score: Optional[float] = None
    context: Dict[str, Any] = field(default_factory=dict)
    
@dataclass
class ImplicitFeedback(FeedbackItem):
    """隱性反饋"""
    intervention_id: Optional[str]
    inferred_score: float  # 推斷的反饋分數
    signals: List[Tuple[str, float]] = field(default_factory=list)
    inference_method: str = "behavioral_analysis"
    supporting_evidence: Dict[str, Any] = field(default_factory=dict)

@dataclass
class InterventionOutcome:
    """建議結果"""
    outcome_id: str
    intervention_id: str
    user_id: str
    outcome_type: str  # immediate, short_term, medium_term, long_term
    measurement_point: datetime
    metrics: Dict[str, float] = field(default_factory=dict)
    overall_score: float = 0.0
    confidence: float = 0.0
    causal_estimate: Optional['CausalEffectEstimate'] = None

@dataclass
class CausalEffectEstimate:
    """因果效應估計"""
    effect_size: float
    confidence_interval: Tuple[float, float]
    p_value: float
    method: str
    assumptions_validated: bool

# -----------------------------------------------------------
# 用戶畫像相關數據結構
# -----------------------------------------------------------

@dataclass
class UserState:
    """用戶當前狀態"""
    timestamp: datetime
    physical_state: Dict[str, Any] = field(default_factory=dict)
    mental_state: Dict[str, Any] = field(default_factory=dict)
    emotional_state: Dict[str, Any] = field(default_factory=dict)
    situational_factors: Dict[str, Any] = field(default_factory=dict)

@dataclass
class BehaviorPattern:
    """行為模式"""
    pattern_id: str
    pattern_type: PatternType
    description: str
    frequency: float
    confidence: float
    first_observed: datetime
    last_observed: datetime
    supporting_evidence: List[Dict] = field(default_factory=list)
    context_conditions: Dict[str, Any] = field(default_factory=dict)

@dataclass
class PreferenceItem:
    """偏好項"""
    preference_id: str
    domain: str
    preference_type: str
    value: Any
    confidence: float
    learned_from: List[str] = field(default_factory=list)
    stability_score: float = 0.5

@dataclass
class DynamicUserProfile:
    """動態用戶畫像"""
    user_id: str
    version: int
    created_at: datetime
    last_updated: datetime
    
    # 核心特徵
    personality_traits: Dict[str, float] = field(default_factory=dict)
    value_hierarchy: List[Dict] = field(default_factory=list)
    long_term_goals: List[Dict] = field(default_factory=list)
    learning_style: Dict[str, Any] = field(default_factory=dict)
    
    # 動態特徵
    current_state: Optional[UserState] = None
    short_term_priorities: List[Dict] = field(default_factory=list)
    behavior_patterns: List[BehaviorPattern] = field(default_factory=list)
    preferences: Dict[str, PreferenceItem] = field(default_factory=dict)
    
    # 元數據
    confidence_scores: Dict[str, float] = field(default_factory=dict)
    data_quality_score: float = 0.0

# -----------------------------------------------------------
# 知識庫相關數據結構
# -----------------------------------------------------------

@dataclass
class KnowledgeItem:
    """知識項"""
    knowledge_id: str
    layer: KnowledgeLayer
    domain: str
    content: str
    source: Dict[str, Any] = field(default_factory=dict)
    credibility_score: float = 0.0
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    version: int = 1
    tags: List[str] = field(default_factory=list)
    related_items: List[str] = field(default_factory=list)
    effectiveness_data: Dict[str, Any] = field(default_factory=dict)
    deprecation_status: Optional[str] = None

@dataclass
class PersonalizedKnowledgeItem:
    """個性化知識項"""
    original_item: KnowledgeItem
    user_id: str
    personalized_content: str
    personalization_factors: Dict[str, Any] = field(default_factory=dict)
    personalization_confidence: float = 0.0
    user_feedback_history: List[Dict] = field(default_factory=list)

@dataclass
class UserKnowledgeBase:
    """用戶專屬知識庫"""
    user_id: str
    version: int
    personalized_knowledge: List[PersonalizedKnowledgeItem] = field(default_factory=list)
    user_specific_knowledge: List[KnowledgeItem] = field(default_factory=list)
    knowledge_graph: Dict[str, Any] = field(default_factory=dict)
    effectiveness_ranking: Dict[str, float] = field(default_factory=dict)
    last_updated: datetime = field(default_factory=datetime.now)

# -----------------------------------------------------------
# Agent相關數據結構
# -----------------------------------------------------------

@dataclass
class AgentPolicy:
    """Agent策略"""
    agent_id: str
    version: int
    policy_type: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    model_weights: Optional[Any] = None
    training_history: List[Dict] = field(default_factory=list)
    performance_history: List[Dict] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)

@dataclass
class RewardedExperience:
    """帶獎勵的經驗"""
    experience_id: str
    agent_id: str
    state: np.ndarray
    action: int
    reward: float
    next_state: np.ndarray
    done: bool
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class CollaborationPattern:
    """協作模式"""
    pattern_id: str
    workflow_id: str
    agent_sequence: List[str]
    communication_graph: Dict[str, List[str]] = field(default_factory=dict)
    task_allocation: Dict[str, str] = field(default_factory=dict)
    performance_metrics: Dict[str, float] = field(default_factory=dict)
    bottleneck_analysis: Dict[str, Any] = field(default_factory=dict)

@dataclass
class ErrorPattern:
    """錯誤模式"""
    pattern_id: str
    error_category: str
    description: str
    frequency: int
    recurrence_rate: float
    affected_components: List[str] = field(default_factory=list)
    root_causes: List[str] = field(default_factory=list)
    impact_score: float = 0.0
    first_seen: datetime = field(default_factory=datetime.now)
    last_seen: datetime = field(default_factory=datetime.now)

# -----------------------------------------------------------
# 監控相關數據結構
# -----------------------------------------------------------

@dataclass
class MetricScore:
    """指標分數"""
    value: Optional[float]
    normalized_value: float
    confidence: float
    status: str
    component_breakdown: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)

@dataclass
class EvolutionScore:
    """進化分數"""
    overall_score: float
    component_scores: Dict[str, MetricScore]
    trends: Dict[str, str] = field(default_factory=dict)
    benchmark_comparison: Dict[str, float] = field(default_factory=dict)
    improvement_areas: List[str] = field(default_factory=list)
    confidence_interval: Tuple[float, float] = (0.0, 1.0)
    timestamp: datetime = field(default_factory=datetime.now)

@dataclass
class Anomaly:
    """異常"""
    anomaly_id: str
    anomaly_type: str
    metric: str
    detected_value: float
    expected_range: Tuple[float, float]
    anomaly_score: float
    severity: str
    detection_method: str
    timestamp: datetime = field(default_factory=datetime.now)
    context: Dict[str, Any] = field(default_factory=dict)

@dataclass
class MonitoringReport:
    """監控報告"""
    timestamp: datetime
    system_metrics: Dict[str, Any] = field(default_factory=dict)
    agent_metrics: Dict[str, Any] = field(default_factory=dict)
    business_metrics: Dict[str, Any] = field(default_factory=dict)
    anomalies: List[Anomaly] = field(default_factory=list)
    alerts: List[Dict] = field(default_factory=list)
    trends: Dict[str, Any] = field(default_factory=dict)
    recommendations: List[Dict] = field(default_factory=list)
```

### 6.3 核心算法實現

```python
# ============================================================
# 核心算法實現
# ============================================================

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import minimize, curve_fit
from scipy.signal import find_peaks, gaussian_filter1d
from sklearn.ensemble import IsolationForest, GradientBoostingClassifier
from sklearn.metrics.pairwise import cosine_similarity
from scipy.stats import linregress
from collections import defaultdict
import torch
import torch.nn as nn
import torch.optim as optim
from typing import Callable

# -----------------------------------------------------------
# 1. 貝葉斯更新算法
# -----------------------------------------------------------

class BayesianUpdater:
    """
    貝葉斯更新器 - 用於用戶畫像和偏好的增量更新
    """
    
    @staticmethod
    def update_beta_prior(
        prior_alpha: float,
        prior_beta: float,
        successes: int,
        trials: int
    ) -> Tuple[float, float]:
        """
        更新Beta分佈先驗
        
        用於二元結果的偏好學習（如：喜歡/不喜歡）
        """
        posterior_alpha = prior_alpha + successes
        posterior_beta = prior_beta + (trials - successes)
        
        return posterior_alpha, posterior_beta
    
    @staticmethod
    def update_normal_prior(
        prior_mean: float,
        prior_var: float,
        observations: List[float],
        observation_var: float
    ) -> Tuple[float, float]:
        """
        更新正態分佈先驗
        
        用於連續值的偏好學習（如：偏好強度）
        """
        n = len(observations)
        obs_mean = np.mean(observations)
        
        # 後驗精度 = 先驗精度 + 數據精度
        posterior_precision = 1/prior_var + n/observation_var
        posterior_var = 1 / posterior_precision
        
        # 後驗均值 = 加權平均
        posterior_mean = posterior_var * (
            prior_mean / prior_var + n * obs_mean / observation_var
        )
        
        return posterior_mean, posterior_var
    
    @staticmethod
    def update_multinomial_prior(
        prior_counts: Dict[str, float],
        observations: Dict[str, int]
    ) -> Dict[str, float]:
        """
        更新多項分佈先驗（Dirichlet）
        
        用於類別偏好的學習
        """
        posterior_counts = {}
        
        for category in set(prior_counts.keys()) | set(observations.keys()):
            prior = prior_counts.get(category, 1.0)  # 默認先驗
            obs = observations.get(category, 0)
            posterior_counts[category] = prior + obs
            
        return posterior_counts

# -----------------------------------------------------------
# 2. 序列模式挖掘算法 (PrefixSpan)
# -----------------------------------------------------------

class PrefixSpanMiner:
    """
    PrefixSpan序列模式挖掘算法
    """
    
    def __init__(self, min_support: float = 0.1, max_length: int = 5):
        self.min_support = min_support
        self.max_length = max_length
        
    def mine(self, sequences: List[List[str]]) -> List[Tuple[List[str], float]]:
        """
        挖掘頻繁序列模式
        
        Args:
            sequences: 行為序列列表，每個序列是行為ID的列表
            
        Returns:
            頻繁序列及其支持度列表
        """
        results = []
        
        def project_database(prefix: List[str], seqs: List[List[str]]) -> List[List[str]]:
            """構建投影數據庫"""
            projected = []
            for seq in seqs:
                # 找到前綴在序列中的位置
                if not prefix:
                    projected.append(seq)
                else:
                    # 查找前綴的最後一項
                    try:
                        idx = -1
                        for i in range(len(seq) - len(prefix) + 1):
                            if seq[i:i+len(prefix)] == prefix:
                                idx = i + len(prefix) - 1
                        
                        if idx >= 0 and idx < len(seq) - 1:
                            projected.append(seq[idx+1:])
                    except:
                        pass
            return projected
        
        def mine_recursive(prefix: List[str], projected_db: List[List[str]], length: int):
            """遞歸挖掘"""
            if length >= self.max_length:
                return
                
            # 統計頻繁項
            item_counts = defaultdict(int)
            for seq in projected_db:
                seen = set()
                for item in seq:
                    if item not in seen:
                        item_counts[item] += 1
                        seen.add(item)
                        
            total = len(sequences)
            
            # 篩選頻繁項
            frequent_items = [
                (item, count / total)
                for item, count in item_counts.items()
                if count / total >= self.min_support
            ]
            
            for item, support in frequent_items:
                new_prefix = prefix + [item]
                results.append((new_prefix, support))
                
                # 遞歸挖掘
                new_projected = project_database(new_prefix, projected_db)
                if new_projected:
                    mine_recursive(new_prefix, new_projected, length + 1)
        
        mine_recursive([], sequences, 0)
        return results

# -----------------------------------------------------------
# 3. 上下文老虎機算法 (LinUCB)
# -----------------------------------------------------------

class LinUCB:
    """
    線性上下文老虎機 (LinUCB) 算法
    
    用於在線學習最優決策策略
    """
    
    def __init__(self, n_actions: int, context_dim: int, alpha: float = 1.0):
        self.n_actions = n_actions
        self.context_dim = context_dim
        self.alpha = alpha
        
        # 每個動作的參數
        self.A = [np.eye(context_dim) for _ in range(n_actions)]
        self.b = [np.zeros(context_dim) for _ in range(n_actions)]
        self.theta = [np.zeros(context_dim) for _ in range(n_actions)]
        
        # 統計信息
        self.action_counts = [0] * n_actions
        self.total_rewards = [0.0] * n_actions
        
    def select_action(self, context: np.ndarray, explore: bool = True) -> int:
        """
        選擇動作
        
        Args:
            context: 上下文特徵向量
            explore: 是否進行探索
            
        Returns:
            選擇的動作ID
        """
        if not explore:
            # 純利用：選擇期望獎勵最高的
            expected_rewards = [
                self.theta[a] @ context for a in range(self.n_actions)
            ]
            return np.argmax(expected_rewards)
        
        # UCB策略
        ucb_scores = []
        
        for a in range(self.n_actions):
            A_inv = np.linalg.inv(self.A[a])
            self.theta[a] = A_inv @ self.b[a]
            
            # 預測獎勵
            predicted_reward = self.theta[a] @ context
            
            # 不確定性項
            uncertainty = self.alpha * np.sqrt(context @ A_inv @ context)
            
            # UCB分數
            ucb_score = predicted_reward + uncertainty
            ucb_scores.append(ucb_score)
            
        return np.argmax(ucb_scores)
    
    def update(self, context: np.ndarray, action: int, reward: float):
        """
        更新模型參數
        
        Args:
            context: 上下文特徵向量
            action: 執行的動作
            reward: 獲得的獎勵
        """
        self.A[action] += np.outer(context, context)
        self.b[action] += reward * context
        self.action_counts[action] += 1
        self.total_rewards[action] += reward
        
    def get_action_stats(self, action: int) -> Dict[str, float]:
        """獲取動作統計信息"""
        if self.action_counts[action] == 0:
            return {'count': 0, 'avg_reward': 0.0}
        
        return {
            'count': self.action_counts[action],
            'avg_reward': self.total_rewards[action] / self.action_counts[action]
        }

# -----------------------------------------------------------
# 4. 異常檢測算法
# -----------------------------------------------------------

class MultivariateAnomalyDetector:
    """
    多變量異常檢測器
    
    結合多種方法進行異常檢測
    """
    
    def __init__(self, contamination: float = 0.1):
        self.contamination = contamination
        self.isolation_forest = IsolationForest(
            contamination=contamination,
            random_state=42,
            n_estimators=100
        )
        self.mean = None
        self.cov = None
        self.mahalanobis_threshold = None
        
    def fit(self, X: np.ndarray):
        """
        訓練異常檢測模型
        
        Args:
            X: 訓練數據，形狀為 (n_samples, n_features)
        """
        # 訓練Isolation Forest
        self.isolation_forest.fit(X)
        
        # 計算馬氏距離參數
        self.mean = np.mean(X, axis=0)
        self.cov = np.cov(X.T)
        
        # 計算馬氏距離閾值
        mahal_distances = self._mahalanobis_distance(X)
        self.mahalanobis_threshold = np.percentile(
            mahal_distances, 
            (1 - self.contamination) * 100
        )
        
    def predict(self, X: np.ndarray) -> Dict[str, np.ndarray]:
        """
        預測異常
        
        Args:
            X: 待檢測數據
            
        Returns:
            包含多種檢測結果的字典
        """
        results = {}
        
        # Isolation Forest預測
        results['isolation_forest'] = self.isolation_forest.predict(X)
        results['if_scores'] = -self.isolation_forest.score_samples(X)
        
        # 馬氏距離
        mahal_distances = self._mahalanobis_distance(X)
        results['mahalanobis'] = mahal_distances
        results['mahal_outliers'] = mahal_distances > self.mahalanobis_threshold
        
        # Z-score方法
        z_scores = np.abs((X - self.mean) / np.sqrt(np.diag(self.cov)))
        results['z_score'] = np.max(z_scores, axis=1)
        results['z_outliers'] = results['z_score'] > 3
        
        # 綜合判斷
        results['combined'] = (
            (results['isolation_forest'] == -1).astype(int) +
            results['mahal_outliers'].astype(int) +
            results['z_outliers'].astype(int)
        ) >= 2  # 至少兩種方法認為是異常
        
        return results
    
    def _mahalanobis_distance(self, X: np.ndarray) -> np.ndarray:
        """計算馬氏距離"""
        try:
            cov_inv = np.linalg.inv(self.cov)
            diff = X - self.mean
            distances = np.sqrt(np.sum(diff @ cov_inv * diff, axis=1))
            return distances
        except:
            # 如果協方差矩陣不可逆，使用偽逆
            cov_pinv = np.linalg.pinv(self.cov)
            diff = X - self.mean
            distances = np.sqrt(np.sum(diff @ cov_pinv * diff, axis=1))
            return distances

# -----------------------------------------------------------
# 5. 時間序列趨勢分析
# -----------------------------------------------------------

class TrendAnalyzer:
    """
    趨勢分析器
    
    分析時間序列數據的趨勢和變化點
    """
    
    @staticmethod
    def linear_trend(
        timestamps: List[datetime],
        values: List[float]
    ) -> Dict[str, Any]:
        """
        線性趨勢分析
        
        Returns:
            包含趨勢斜率、R²、p值等信息的字典
        """
        # 轉換時間為數值
        x = np.array([(t - timestamps[0]).total_seconds() / 86400 
                      for t in timestamps])
        y = np.array(values)
        
        # 線性回歸
        slope, intercept, r_value, p_value, std_err = linregress(x, y)
        
        return {
            'slope': slope,
            'intercept': intercept,
            'r_squared': r_value ** 2,
            'p_value': p_value,
            'std_error': std_err,
            'trend_direction': 'increasing' if slope > 0 else 'decreasing' if slope < 0 else 'stable',
            'significance': 'significant' if p_value < 0.05 else 'not_significant'
        }
    
    @staticmethod
    def detect_change_points(
        values: List[float],
        method: str = 'cusum'
    ) -> List[int]:
        """
        檢測變化點
        
        Args:
            values: 時間序列值
            method: 檢測方法 ('cusum', 'pelt', 'binary_segmentation')
            
        Returns:
            變化點索引列表
        """
        if method == 'cusum':
            return TrendAnalyzer._cusum_change_detection(values)
        elif method == 'simple':
            return TrendAnalyzer._simple_change_detection(values)
        else:
            raise ValueError(f"Unknown method: {method}")
    
    @staticmethod
    def _cusum_change_detection(
        values: List[float],
        threshold: float = 5.0,
        drift: float = 1.0
    ) -> List[int]:
        """
        CUSUM變化點檢測
        """
        change_points = []
        
        # 計算均值和標準差
        mean_val = np.mean(values)
        std_val = np.std(values)
        
        # 標準化
        normalized = [(v - mean_val) / std_val for v in values]
        
        # CUSUM統計量
        s_pos = 0
        s_neg = 0
        
        for i, x in enumerate(normalized):
            s_pos = max(0, s_pos + x - drift)
            s_neg = min(0, s_neg + x + drift)
            
            if s_pos > threshold or abs(s_neg) > threshold:
                change_points.append(i)
                s_pos = 0
                s_neg = 0
                
        return change_points
    
    @staticmethod
    def _simple_change_detection(
        values: List[float],
        window_size: int = 7,
        threshold_std: float = 2.0
    ) -> List[int]:
        """
        簡單變化點檢測（基於滑動窗口）
        """
        change_points = []
        
        for i in range(window_size, len(values) - window_size):
            before = values[i-window_size:i]
            after = values[i:i+window_size]
            
            before_mean = np.mean(before)
            after_mean = np.mean(after)
            
            pooled_std = np.sqrt(
                (np.var(before) + np.var(after)) / 2
            )
            
            if pooled_std > 0:
                z_score = abs(after_mean - before_mean) / (
                    pooled_std * np.sqrt(2 / window_size)
                )
                
                if z_score > threshold_std:
                    change_points.append(i)
                    
        return change_points
```

### 6.4 實現步驟與部署建議

```
# ============================================================
# 實現步驟與部署建議
# ============================================================

## Phase 1: 基礎設施搭建 (Weeks 1-4)

### 1.1 數據存儲層
- [ ] 設置PostgreSQL用於結構化數據存儲
- [ ] 設置Redis用於緩存和實時數據
- [ ] 設置ChromaDB/Qdrant用於向量存儲
- [ ] 設置時序數據庫(InfluxDB/TimescaleDB)用於指標數據

### 1.2 數據收集管道
- [ ] 實現反饋收集API
- [ ] 設置事件追蹤系統
- [ ] 實現數據清洗和驗證管道
- [ ] 設置數據備份和恢復機制

### 1.3 基礎監控
- [ ] 設置指標收集(Prometheus)
- [ ] 設置可視化儀表板(Grafana)
- [ ] 設置基礎告警機制

## Phase 2: 核心引擎開發 (Weeks 5-10)

### 2.1 反饋處理引擎
- [ ] 實現顯性反饋處理器
- [ ] 實現隱性反饋推斷器
- [ ] 實現反饋整合引擎
- [ ] 實現A/B測試框架

### 2.2 用戶畫像引擎
- [ ] 實現核心特徵更新器
- [ ] 實現動態特徵更新器
- [ ] 實現行為模式挖掘器
- [ ] 實現偏好學習引擎

### 2.3 知識庫引擎
- [ ] 實現三層知識更新器
- [ ] 實現知識驗證管道
- [ ] 實現知識淘汰機制
- [ ] 實現用戶專屬知識庫構建器

## Phase 3: Agent優化引擎 (Weeks 11-16)

### 3.1 決策學習引擎
- [ ] 實現上下文老虎機優化器
- [ ] 實現強化學習優化器(PPO)
- [ ] 實現經驗回放緩衝區
- [ ] 實現策略版本管理

### 3.2 協作優化引擎
- [ ] 實現通信優化器
- [ ] 實現自適應任務分配器
- [ ] 實現協調學習器

### 3.3 錯誤修正引擎
- [ ] 實現錯誤模式檢測器
- [ ] 實現根本原因分析器
- [ ] 實現修正策略庫
- [ ] 實現漸進式修正部署

## Phase 4: 監控與評估系統 (Weeks 17-20)

### 4.1 效能監控系統
- [ ] 實現多維度指標收集
- [ ] 實現異常檢測引擎
- [ ] 實現自動調整引擎
- [ ] 實現告警管理系統

### 4.2 進化效果評估
- [ ] 實現核心指標計算器
- [ ] 實現進化速度分析器
- [ ] 實現LTV評估框架
- [ ] 實現ROI計算器

## Phase 5: 集成與優化 (Weeks 21-24)

### 5.1 系統集成
- [ ] 集成所有引擎組件
- [ ] 實現組件間通信機制
- [ ] 進行端到端測試
- [ ] 性能優化

### 5.2 生產部署
- [ ] 設置生產環境
- [ ] 實現藍綠部署
- [ ] 設置災難恢復計劃
- [ ] 進行壓力測試

## 關鍵技術選型建議

### 機器學習框架
- PyTorch: 深度學習模型
- Scikit-learn: 傳統機器學習算法
- MLflow: 模型版本管理和追蹤

### 數據處理
- Apache Spark: 大規模數據處理
- Pandas: 數據分析
- NumPy: 數值計算

### 工作流編排
- Apache Airflow: 批處理工作流
- Celery: 異步任務隊列
- Redis Streams: 實時事件處理

### 監控和可觀測性
- Prometheus + Grafana: 指標監控
- ELK Stack: 日誌分析
- Jaeger: 分佈式追蹤

## 風險緩解策略

### 1. 數據質量風險
- 實施多層數據驗證
- 設置數據質量監控
- 建立數據異常處理流程

### 2. 模型風險
- 實施A/B測試驗證
- 設置模型性能監控
- 建立快速回滾機制

### 3. 系統穩定性風險
- 實施漸進式部署
- 設置熔斷機制
- 建立災難恢復計劃

### 4. 隱私和合規風險
- 實施數據脫敏
- 建立用戶數據控制機制
- 定期合規審計
```

---

## 7. 總結

本設計為「多AI協作生活教練系統」提供了一套完整的自我進化機制，涵蓋以下核心組件：

### 核心能力

1. **全方位反饋收集**: 結合顯性和隱性反饋，建立完整的用戶反饋迴路
2. **智能個人化**: 持續學習用戶特徵、偏好和行為模式
3. **動態知識庫**: 三層知識架構持續更新，確保知識的時效性和準確性
4. **自適應Agent**: Agent決策策略持續優化，協作效率不斷提升
5. **閉環監控**: 完整的監控、評估和自動調整機制

### 技術亮點

- **貝葉斯更新機制**: 實現用戶畫像的增量學習
- **上下文老虎機**: 在線學習最優決策策略
- **因果推斷引擎**: 準確評估建議效果
- **多層次模式挖掘**: 自動發現用戶行為規律
- **異常檢測系統**: 及時發現和解決問題

### 預期效果

- 用戶滿意度提升 30%+
- 建議採納率提升 40%+
- 目標達成率提升 25%+
- 系統信任度持續增長
- 長期用戶留存率提升 35%+

---

*文檔版本: 1.0*
*最後更新: 2024年*
