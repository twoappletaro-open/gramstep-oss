import { z } from "zod";

export const SyncPolicySchema = z.enum(["none", "recent_7d"]);
export type SyncPolicy = z.infer<typeof SyncPolicySchema>;

export const AccountSettingsSchema = z.object({
  delivery_window_start: z.number().int().min(0).max(23).default(9),
  delivery_window_end: z.number().int().min(0).max(23).default(23),
  re_engagement_enabled: z.boolean().default(true),
  opt_out_keywords: z.array(z.string()).default(["停止", "解除", "stop"]),
  weekly_broadcast_limit: z.number().int().min(0).nullable().default(null),
  no_response_skip_threshold: z.number().int().min(0).default(3),
  sync_policy: SyncPolicySchema.default("none"),
});

export type AccountSettings = z.infer<typeof AccountSettingsSchema>;

export const MediaCategorySchema = z.enum(["text", "image", "audio_video"]);
export type MediaCategory = z.infer<typeof MediaCategorySchema>;

export const TriggerTypeSchema = z.enum([
  "comment",
  "story_comment",
  "story_mention",
  "live_comment",
  "dm",
  "url_param",
  "ice_breaker",
]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const MatchTypeSchema = z.enum(["exact", "partial", "regex"]);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const TriggerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send_template"), templateId: z.string() }),
  z.object({ type: z.literal("add_tag"), tagId: z.string() }),
  z.object({ type: z.literal("remove_tag"), tagId: z.string() }),
  z.object({ type: z.literal("enroll_scenario"), scenarioId: z.string() }),
  z.object({ type: z.literal("start_survey"), surveyId: z.string() }),
  z.object({ type: z.literal("webhook"), url: z.string().url() }),
  z.object({ type: z.literal("update_metadata"), key: z.string(), value: z.string() }),
  z.object({ type: z.literal("update_score"), delta: z.number().int() }),
  z.object({ type: z.literal("send_reaction"), emoji: z.string() }),
  z.object({ type: z.literal("enter_campaign"), campaignId: z.string() }),
]);
export type TriggerAction = z.infer<typeof TriggerActionSchema>;

export const EnrollmentStatusSchema = z.enum([
  "active",
  "window_expired",
  "paused",
  "completed",
  "cancelled",
]);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

export const MessageDirectionSchema = z.enum(["inbound", "outbound"]);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageSourceTypeSchema = z.enum([
  "webhook",
  "scenario",
  "broadcast",
  "manual",
  "system",
  "campaign",
]);
export type MessageSourceType = z.infer<typeof MessageSourceTypeSchema>;

export const DeliveryStatusSchema = z.enum(["queued", "sent", "delivered", "read", "failed"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const HealthScoreSchema = z.enum(["normal", "warning", "danger"]);
export type HealthScore = z.infer<typeof HealthScoreSchema>;

export const OperatorRoleSchema = z.enum(["admin", "operator", "viewer"]);
export type OperatorRole = z.infer<typeof OperatorRoleSchema>;

export const FollowerStatusSchema = z.enum(["following", "not_following", "unknown"]);
export type FollowerStatus = z.infer<typeof FollowerStatusSchema>;

export const CheckpointStatusSchema = z.enum(["pending", "resumed", "cancelled"]);
export type CheckpointStatus = z.infer<typeof CheckpointStatusSchema>;

export const DeletedUserStatusSchema = z.enum(["pending", "completed"]);
export type DeletedUserStatus = z.infer<typeof DeletedUserStatusSchema>;

export const ConditionConfigSchema = z.object({
  type: z.literal("branch"),
  conditions: z.array(
    z.object({
      field: z.enum(["tag", "score", "metadata", "follower_status", "has_dm_history"]),
      operator: z.enum(["has", "not_has", "eq", "neq", "gt", "gte", "lt", "lte"]),
      value: z.union([z.string(), z.number()]),
      key: z.string().optional(),
      next_step_order: z.number().int(),
    }),
  ),
  default_next_step_order: z.number().int(),
});
export type ConditionConfig = z.infer<typeof ConditionConfigSchema>;

export const CreateStepInputSchema = z.object({
  step_order: z.number().int().min(1),
  delay_seconds: z.number().int().min(0).default(0),
  absolute_datetime: z.number().int().nullable().default(null),
  message_type: z.enum(["text", "image", "generic", "quick_reply"]),
  message_payload: z.string(),
  condition_config: ConditionConfigSchema.nullable().default(null),
});
export type CreateStepInput = z.infer<typeof CreateStepInputSchema>;

export const CreateScenarioInputSchema = z.object({
  name: z.string().min(1).max(255),
  trigger_type: TriggerTypeSchema,
  trigger_config: z.string().default("{}"),
  steps: z.array(CreateStepInputSchema).min(1),
  bot_disclosure_enabled: z.boolean().default(false),
});
export type CreateScenarioInput = z.infer<typeof CreateScenarioInputSchema>;

export const UpdateScenarioInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  trigger_type: TriggerTypeSchema.optional(),
  trigger_config: z.string().optional(),
  is_active: z.boolean().optional(),
  bot_disclosure_enabled: z.boolean().optional(),
  steps: z.array(CreateStepInputSchema).min(1).optional(),
  version: z.number().int(),
});
export type UpdateScenarioInput = z.infer<typeof UpdateScenarioInputSchema>;

export const SendQueueMessageSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  igUserId: z.string(),
  recipientId: z.string(),
  messagePayload: z.string(),
  mediaCategory: MediaCategorySchema,
  sourceType: MessageSourceTypeSchema,
  sourceId: z.string().nullable(),
  enrollmentId: z.string().nullable(),
  retryCount: z.number().int().min(0).default(0),
  mediaUrl: z.string().nullable().optional(),
  mediaUrlHash: z.string().nullable().optional(),
  tag: z.enum(["HUMAN_AGENT"]).nullable().optional(),
  dispatchId: z.string().nullable().optional(),
});
export type SendQueueMessage = z.infer<typeof SendQueueMessageSchema>;

export const FireModeSchema = z.enum(["once", "unlimited", "first_only"]);
export type FireMode = z.infer<typeof FireModeSchema>;

export const ScheduleConfigSchema = z.object({
  days_of_week: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
  start_hour: z.number().int().min(0).max(23).default(0),
  end_hour: z.number().int().min(0).max(23).default(23),
  start_date: z.number().int().nullable().default(null),
  end_date: z.number().int().nullable().default(null),
});
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

export const CreateTriggerInputSchema = z.object({
  name: z.string().min(1).max(255),
  trigger_type: TriggerTypeSchema,
  match_type: MatchTypeSchema.default("partial"),
  keywords: z.array(z.string()).default([]),
  actions: z.array(TriggerActionSchema).min(1),
  schedule_config: ScheduleConfigSchema.nullable().default(null),
  fire_mode: FireModeSchema.default("unlimited"),
  is_active: z.boolean().default(true),
});
export type CreateTriggerInput = z.infer<typeof CreateTriggerInputSchema>;

export const UpdateTriggerInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  trigger_type: TriggerTypeSchema.optional(),
  match_type: MatchTypeSchema.optional(),
  keywords: z.array(z.string()).optional(),
  actions: z.array(TriggerActionSchema).min(1).optional(),
  schedule_config: ScheduleConfigSchema.nullable().optional(),
  fire_mode: FireModeSchema.optional(),
  is_active: z.boolean().optional(),
  version: z.number().int(),
});
export type UpdateTriggerInput = z.infer<typeof UpdateTriggerInputSchema>;

// --- Automation Engine (Task 7.3) ---

export const AutomationConditionSchema = z.object({
  field: z.enum(["tag", "score", "metadata"]),
  operator: z.enum(["has", "not_has", "eq", "neq", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number()]),
  key: z.string().optional(),
});
export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;

export const AutomationConditionGroupSchema = z.object({
  logic: z.enum(["and", "or"]),
  conditions: z.array(AutomationConditionSchema).min(1),
});
export type AutomationConditionGroup = z.infer<typeof AutomationConditionGroupSchema>;

export const CreateAutomationRuleInputSchema = z.object({
  name: z.string().min(1).max(255),
  condition_group: AutomationConditionGroupSchema,
  actions: z.array(TriggerActionSchema).min(1),
  is_active: z.boolean().default(true),
});
export type CreateAutomationRuleInput = z.infer<typeof CreateAutomationRuleInputSchema>;

export const UpdateAutomationRuleInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  condition_group: AutomationConditionGroupSchema.optional(),
  actions: z.array(TriggerActionSchema).min(1).optional(),
  is_active: z.boolean().optional(),
  version: z.number().int(),
});
export type UpdateAutomationRuleInput = z.infer<typeof UpdateAutomationRuleInputSchema>;

// --- Lottery Engine (Task 7.4) ---

export const LotteryModeSchema = z.enum(["instant", "batch"]);
export type LotteryMode = z.infer<typeof LotteryModeSchema>;

export const LotteryConfigSchema = z.object({
  mode: LotteryModeSchema,
  win_probability: z.number().min(0).max(100),
  max_winners: z.number().int().min(1),
  win_message: z.string().min(1),
  lose_message: z.string().min(1),
  deadline: z.number().int().nullable().default(null),
});
export type LotteryConfig = z.infer<typeof LotteryConfigSchema>;

export const LotteryEntrySchema = z.object({
  ig_user_id: z.string(),
  entered_at: z.number().int(),
});
export type LotteryEntry = z.infer<typeof LotteryEntrySchema>;

export const LotteryResultSchema = z.enum(["win", "lose"]);
export type LotteryResult = z.infer<typeof LotteryResultSchema>;

// --- Template Engine (Task 16.1) ---

export const TemplateTypeSchema = z.enum(["text", "generic", "quick_reply", "media"]);
export type TemplateType = z.infer<typeof TemplateTypeSchema>;

export const TemplateVariableSchema = z.object({
  name: z.string().min(1),
  defaultValue: z.string().default(""),
  dataSource: z.enum(["metadata", "tag", "score", "static"]),
  metadataKey: z.string().optional(),
});
export type TemplateVariable = z.infer<typeof TemplateVariableSchema>;

export const CreateTemplateInputSchema = z.object({
  name: z.string().min(1).max(255),
  type: TemplateTypeSchema,
  body: z.string().min(1).max(10000),
  variables: z.array(TemplateVariableSchema).default([]),
});
export type CreateTemplateInput = z.infer<typeof CreateTemplateInputSchema>;

export const UpdateTemplateInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: TemplateTypeSchema.optional(),
  body: z.string().min(1).max(10000).optional(),
  variables: z.array(TemplateVariableSchema).optional(),
  is_active: z.boolean().optional(),
  version: z.number().int(),
});
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateInputSchema>;

export const WebhookFieldSchema = z.enum([
  "messages",
  "messaging_postbacks",
  "messaging_referral",
  "messaging_seen",
  "message_reactions",
  "comments",
  "live_comments",
  "messaging_handover",
  "message_edit",
]);
export type WebhookField = z.infer<typeof WebhookFieldSchema>;

// --- Chat & Conversation Management (Task 9.6) ---

export const ConversationStatusSchema = z.enum([
  "unread",
  "in_progress",
  "resolved",
  "custom",
]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const ChatControlModeSchema = z.enum(["bot", "human"]);
export type ChatControlMode = z.infer<typeof ChatControlModeSchema>;

export const SendManualMessageInputSchema = z.object({
  ig_user_id: z.string().min(1),
  message_type: z.enum(["text", "image"]),
  content: z.string().min(1).max(2000),
  media_url: z.string().url().optional(),
});
export type SendManualMessageInput = z.infer<typeof SendManualMessageInputSchema>;

export const ChatFiltersSchema = z.object({
  status: ConversationStatusSchema.optional(),
  assigned_operator_id: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type ChatFilters = z.infer<typeof ChatFiltersSchema>;

export const UpdateConversationStatusInputSchema = z.object({
  status: ConversationStatusSchema,
  custom_label: z.string().max(255).optional(),
});
export type UpdateConversationStatusInput = z.infer<typeof UpdateConversationStatusInputSchema>;

export const AssignOperatorInputSchema = z.object({
  operator_id: z.string().min(1),
});
export type AssignOperatorInput = z.infer<typeof AssignOperatorInputSchema>;

// --- User Management (Task 8.1, 8.2) ---

export const UpdateUserInputSchema = z.object({
  ig_username: z.string().optional(),
  display_name: z.string().optional(),
  follower_status: FollowerStatusSchema.optional(),
  timezone: z.string().nullable().optional(),
  preferred_delivery_hour: z.number().int().min(0).max(23).nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

export const UserFiltersSchema = z.object({
  tags: z.array(z.string()).optional(),
  score_min: z.coerce.number().int().optional(),
  score_max: z.coerce.number().int().optional(),
  follower_status: FollowerStatusSchema.optional(),
  last_interaction_after: z.coerce.number().int().optional(),
  is_opted_out: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type UserFilters = z.infer<typeof UserFiltersSchema>;

export const UpdateMetadataInputSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().max(4096),
});
export type UpdateMetadataInput = z.infer<typeof UpdateMetadataInputSchema>;

export const AddTagInputSchema = z.object({
  tag_id: z.string().min(1),
});
export type AddTagInput = z.infer<typeof AddTagInputSchema>;

export const CreateTagInputSchema = z.object({
  name: z.string().min(1).max(255),
});
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;

export const CreateScoringRuleInputSchema = z.object({
  event_type: z.string().min(1).max(255),
  score_delta: z.number().int(),
});
export type CreateScoringRuleInput = z.infer<typeof CreateScoringRuleInputSchema>;

// --- Message Log Filters (Task 10.1) ---

export const MessageLogFiltersSchema = z.object({
  accountId: z.string().min(1),
  igUserId: z.string().optional(),
  keyword: z.string().optional(),
  dateFrom: z.coerce.number().int().optional(),
  dateTo: z.coerce.number().int().optional(),
  messageType: z.string().optional(),
  sourceType: MessageSourceTypeSchema.optional(),
  direction: MessageDirectionSchema.optional(),
  deliveryStatus: DeliveryStatusSchema.optional(),
  excludeTest: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
export type MessageLogFiltersInput = z.infer<typeof MessageLogFiltersSchema>;

// --- Analytics ---

// --- Broadcast Engine (Task 17.1) ---

export const SegmentOperatorSchema = z.enum(["and", "or"]);
export type SegmentOperator = z.infer<typeof SegmentOperatorSchema>;

export const SegmentConditionSchema = z.object({
  field: z.enum(["tag", "metadata", "score", "follower_status"]),
  operator: z.enum(["has", "not_has", "eq", "neq", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number()]),
  key: z.string().optional(),
});
export type SegmentCondition = z.infer<typeof SegmentConditionSchema>;

export const SegmentFilterSchema = z.object({
  logic: SegmentOperatorSchema,
  conditions: z.array(SegmentConditionSchema).min(1),
});
export type SegmentFilter = z.infer<typeof SegmentFilterSchema>;

export const BroadcastStatusSchema = z.enum(["draft", "scheduled", "sending", "completed", "cancelled"]);
export type BroadcastStatus = z.infer<typeof BroadcastStatusSchema>;

export const CreateBroadcastInputSchema = z.object({
  name: z.string().min(1).max(255),
  template_id: z.string().min(1),
  segment: SegmentFilterSchema,
  scheduled_at: z.number().int().nullable().default(null),
});
export type CreateBroadcastInput = z.infer<typeof CreateBroadcastInputSchema>;

// --- Stealth Mode (Task 19.2) ---

export const StealthConfigSchema = z.object({
  jitter_enabled: z.boolean().default(true),
  jitter_min_seconds: z.number().int().min(0).default(60),
  jitter_max_seconds: z.number().int().min(0).default(300),
  variation_enabled: z.boolean().default(true),
});
export type StealthConfig = z.infer<typeof StealthConfigSchema>;

// --- Notification Engine (Task 20.1) ---

export const NotificationLevelSchema = z.enum(["info", "warning", "critical"]);
export type NotificationLevel = z.infer<typeof NotificationLevelSchema>;

export const NotificationChannelSchema = z.enum(["webhook", "email", "dashboard"]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationEventTypeSchema = z.enum([
  "new_user",
  "conversion",
  "rate_limit_80",
  "health_degraded",
  "token_expiring",
  "policy_violation",
]);
export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;

export const CreateNotificationRuleInputSchema = z.object({
  name: z.string().min(1).max(255),
  event_type: NotificationEventTypeSchema,
  level: NotificationLevelSchema,
  channels: z.array(NotificationChannelSchema).min(1),
  webhook_url: z.string().url().nullable().default(null),
  email_to: z.string().email().nullable().default(null),
  is_active: z.boolean().default(true),
});
export type CreateNotificationRuleInput = z.infer<typeof CreateNotificationRuleInputSchema>;

export const UpdateNotificationRuleInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  event_type: NotificationEventTypeSchema.optional(),
  level: NotificationLevelSchema.optional(),
  channels: z.array(NotificationChannelSchema).min(1).optional(),
  webhook_url: z.string().url().nullable().optional(),
  email_to: z.string().email().nullable().optional(),
  is_active: z.boolean().optional(),
});
export type UpdateNotificationRuleInput = z.infer<typeof UpdateNotificationRuleInputSchema>;

// --- Form Builder (Task 16.2) ---

export const QuickReplyOptionSchema = z.object({
  title: z.string().min(1).max(20),
  payload: z.string().min(1),
  metadata_key: z.string().optional(),
});
export type QuickReplyOption = z.infer<typeof QuickReplyOptionSchema>;

export const CreateFormStepInputSchema = z.object({
  step_order: z.number().int().min(1),
  question_text: z.string().min(1).max(1000),
  quick_replies: z.array(QuickReplyOptionSchema).min(1).max(13),
  metadata_key: z.string().nullable().default(null),
});
export type CreateFormStepInput = z.infer<typeof CreateFormStepInputSchema>;

export const CreateFormInputSchema = z.object({
  name: z.string().min(1).max(255),
  steps: z.array(CreateFormStepInputSchema).min(1),
});
export type CreateFormInput = z.infer<typeof CreateFormInputSchema>;

export const FormSessionStatusSchema = z.enum(["in_progress", "completed", "abandoned"]);
export type FormSessionStatus = z.infer<typeof FormSessionStatusSchema>;

export const SurveyFieldTypeSchema = z.enum(["default_attribute", "custom_attribute", "free_input"]);
export type SurveyFieldType = z.infer<typeof SurveyFieldTypeSchema>;

export const SurveyAnswerModeSchema = z.enum(["free_text", "choice"]);
export type SurveyAnswerMode = z.infer<typeof SurveyAnswerModeSchema>;

export const SurveyOptionSchema = z.object({
  label: z.string().min(1).max(20),
  value: z.string().min(1).max(255),
});
export type SurveyOption = z.infer<typeof SurveyOptionSchema>;

export const CreateSurveyStepInputSchema = z.object({
  step_order: z.number().int().min(1),
  field_type: SurveyFieldTypeSchema,
  field_key: z.string().min(1).max(255).nullable().default(null),
  answer_mode: SurveyAnswerModeSchema,
  question_text: z.string().min(1).max(1000),
  options: z.array(SurveyOptionSchema).max(10).default([]),
});
export type CreateSurveyStepInput = z.infer<typeof CreateSurveyStepInputSchema>;

export const CreateSurveyInputSchema = z.object({
  name: z.string().min(1).max(255),
  completion_template_id: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
  steps: z.array(CreateSurveyStepInputSchema).min(1),
});
export type CreateSurveyInput = z.infer<typeof CreateSurveyInputSchema>;

export const UpdateSurveyInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  completion_template_id: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  steps: z.array(CreateSurveyStepInputSchema).min(1).optional(),
});
export type UpdateSurveyInput = z.infer<typeof UpdateSurveyInputSchema>;

// --- A/B Test Engine (Task 16.3) ---

export const CreateAbTestVariantInputSchema = z.object({
  name: z.string().min(1).max(255),
  body: z.string().min(1).max(10000),
  weight: z.number().int().min(1).default(1),
});
export type CreateAbTestVariantInput = z.infer<typeof CreateAbTestVariantInputSchema>;

export const CreateAbTestInputSchema = z.object({
  template_id: z.string().min(1),
  name: z.string().min(1).max(255),
  variants: z.array(CreateAbTestVariantInputSchema).min(2).max(3),
});
export type CreateAbTestInput = z.infer<typeof CreateAbTestInputSchema>;

export const AbTestEventTypeSchema = z.enum(["click", "conversion"]);
export type AbTestEventType = z.infer<typeof AbTestEventTypeSchema>;

// --- Custom Variable Management (Task 16.4) ---

export const CustomVariableDataSourceSchema = z.enum(["metadata", "tag", "score", "static"]);
export type CustomVariableDataSource = z.infer<typeof CustomVariableDataSourceSchema>;

export const CreateCustomVariableInputSchema = z.object({
  name: z.string().min(1).max(255),
  default_value: z.string().default(""),
  data_source: CustomVariableDataSourceSchema.default("static"),
  metadata_key: z.string().nullable().default(null),
});
export type CreateCustomVariableInput = z.infer<typeof CreateCustomVariableInputSchema>;

export const UpdateCustomVariableInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  default_value: z.string().optional(),
  data_source: CustomVariableDataSourceSchema.optional(),
  metadata_key: z.string().nullable().optional(),
});
export type UpdateCustomVariableInput = z.infer<typeof UpdateCustomVariableInputSchema>;

export const AnalyticsPeriodSchema = z.enum(["7d", "30d", "90d"]);
export type AnalyticsPeriod = z.infer<typeof AnalyticsPeriodSchema>;

export const AnalyticsQuerySchema = z.object({
  period: AnalyticsPeriodSchema.default("30d"),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

export const DailyDeliveryStatSchema = z.object({
  date: z.string(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  failed: z.number().int(),
});
export type DailyDeliveryStat = z.infer<typeof DailyDeliveryStatSchema>;

export const DeliveryMetricsSchema = z.object({
  daily_stats: z.array(DailyDeliveryStatSchema),
  total_sent: z.number().int(),
  total_delivered: z.number().int(),
  total_read: z.number().int(),
  total_failed: z.number().int(),
  read_rate: z.number(),
  click_count: z.number().int(),
  click_rate: z.number(),
  cv_event_count: z.number().int(),
  window_validity_rate: z.number(),
  window_expiry_dropout_rate: z.number(),
  scenario_completion_rate: z.number(),
});
export type DeliveryMetrics = z.infer<typeof DeliveryMetricsSchema>;

export const AccountHealthSchema = z.object({
  account_id: z.string(),
  ig_username: z.string().nullable(),
  connected: z.boolean(),
  token_expires_at: z.number(),
  token_days_remaining: z.number(),
  health_score: HealthScoreSchema,
  rate_limit_usage: z.object({
    daily_sent: z.number().int(),
    daily_limit: z.number().int(),
    usage_percent: z.number(),
  }),
});
export type AccountHealth = z.infer<typeof AccountHealthSchema>;

// --- Outgoing Webhook ---

export const OutgoingWebhookEventTypeSchema = z.enum([
  "scenario_completed",
  "tag_changed",
  "new_user",
  "cv_occurred",
  "opt_out",
  "message_sent",
  "message_received",
]);
export type OutgoingWebhookEventType = z.infer<typeof OutgoingWebhookEventTypeSchema>;

export const CreateOutgoingWebhookInputSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url(),
  event_types: z.array(OutgoingWebhookEventTypeSchema).min(1),
});
export type CreateOutgoingWebhookInput = z.infer<typeof CreateOutgoingWebhookInputSchema>;

export const UpdateOutgoingWebhookInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().optional(),
  event_types: z.array(OutgoingWebhookEventTypeSchema).min(1).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateOutgoingWebhookInput = z.infer<typeof UpdateOutgoingWebhookInputSchema>;

// --- Incoming Webhook ---

export const IncomingWebhookActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_tag"), tag_name: z.string() }),
  z.object({ type: z.literal("remove_tag"), tag_name: z.string() }),
  z.object({ type: z.literal("enroll_scenario"), scenario_id: z.string() }),
  z.object({ type: z.literal("update_metadata"), key: z.string(), value: z.string() }),
  z.object({ type: z.literal("update_score"), delta: z.number().int() }),
  z.object({ type: z.literal("record_cv"), conversion_point_id: z.string(), value: z.number().optional() }),
]);
export type IncomingWebhookAction = z.infer<typeof IncomingWebhookActionSchema>;

export const CreateIncomingWebhookInputSchema = z.object({
  name: z.string().min(1).max(255),
  actions: z.array(IncomingWebhookActionSchema).min(1),
});
export type CreateIncomingWebhookInput = z.infer<typeof CreateIncomingWebhookInputSchema>;

export const UpdateIncomingWebhookInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  actions: z.array(IncomingWebhookActionSchema).min(1).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateIncomingWebhookInput = z.infer<typeof UpdateIncomingWebhookInputSchema>;

export const IncomingWebhookPayloadSchema = z.object({
  ig_scoped_id: z.string().min(1),
  event_type: z.string().min(1).optional(),
  data: z.record(z.unknown()).optional(),
});
export type IncomingWebhookPayload = z.infer<typeof IncomingWebhookPayloadSchema>;

// --- CV Tracking ---

export const ConversionPointTypeSchema = z.enum(["purchase", "signup", "custom"]);
export type ConversionPointType = z.infer<typeof ConversionPointTypeSchema>;

export const CreateConversionPointInputSchema = z.object({
  name: z.string().min(1).max(255),
  type: ConversionPointTypeSchema.default("custom"),
  value: z.number().default(0),
});
export type CreateConversionPointInput = z.infer<typeof CreateConversionPointInputSchema>;

export const UpdateConversionPointInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: ConversionPointTypeSchema.optional(),
  value: z.number().optional(),
  is_active: z.boolean().optional(),
});
export type UpdateConversionPointInput = z.infer<typeof UpdateConversionPointInputSchema>;

export const RecordConversionEventInputSchema = z.object({
  conversion_point_id: z.string().min(1),
  ig_user_id: z.string().optional(),
  scenario_id: z.string().optional(),
  value: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type RecordConversionEventInput = z.infer<typeof RecordConversionEventInputSchema>;

// --- API Key Management ---

// --- URL Tracking (Task 23.1) ---

export const LinkClickActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_tag"), tag_name: z.string().min(1) }),
  z.object({ type: z.literal("enroll_scenario"), scenario_id: z.string().min(1) }),
]);
export type LinkClickAction = z.infer<typeof LinkClickActionSchema>;

export const CreateTrackedLinkInputSchema = z.object({
  original_url: z.string().url(),
  source_type: z.enum(["manual", "scenario", "broadcast", "template"]).default("manual"),
  source_id: z.string().nullable().default(null),
  click_actions: z.array(LinkClickActionSchema).default([]),
});
export type CreateTrackedLinkInput = z.infer<typeof CreateTrackedLinkInputSchema>;

export const RecordClickInputSchema = z.object({
  ig_user_id: z.string().nullable().default(null),
});
export type RecordClickInput = z.infer<typeof RecordClickInputSchema>;

// --- Entry Route Tracking (Task 23.2) ---

export const EntryRouteActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_tag"), tag_name: z.string().min(1) }),
  z.object({ type: z.literal("enroll_scenario"), scenario_id: z.string().min(1) }),
]);
export type EntryRouteAction = z.infer<typeof EntryRouteActionSchema>;

export const CreateEntryRouteInputSchema = z.object({
  ref_code: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1).max(255),
  actions: z.array(EntryRouteActionSchema).default([]),
});
export type CreateEntryRouteInput = z.infer<typeof CreateEntryRouteInputSchema>;

export const UpdateEntryRouteInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  actions: z.array(EntryRouteActionSchema).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateEntryRouteInput = z.infer<typeof UpdateEntryRouteInputSchema>;

export const RecordEntryRouteEventInputSchema = z.object({
  ig_user_id: z.string().min(1),
  ref_code: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
});
export type RecordEntryRouteEventInput = z.infer<typeof RecordEntryRouteEventInputSchema>;

export const ApiKeyScopeSchema = z.enum(["read", "write", "admin"]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const CreateApiKeyInputSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  scopes: z.array(ApiKeyScopeSchema).min(1).default(["read"]),
  expires_in_days: z.number().int().min(1).max(365).optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const UpdateApiKeyInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  scopes: z.array(ApiKeyScopeSchema).min(1).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateApiKeyInput = z.infer<typeof UpdateApiKeyInputSchema>;

// --- Reminder (Task 24.1) ---

export const ReminderEnrollmentStatusSchema = z.enum(["active", "completed", "cancelled"]);
export type ReminderEnrollmentStatus = z.infer<typeof ReminderEnrollmentStatusSchema>;

export const CreateReminderStepInputSchema = z.object({
  step_order: z.number().int().min(1),
  offset_seconds: z.number().int(),
  message_type: z.enum(["text", "image", "generic", "quick_reply"]),
  message_payload: z.string().min(1),
});
export type CreateReminderStepInput = z.infer<typeof CreateReminderStepInputSchema>;

export const CreateReminderInputSchema = z.object({
  name: z.string().min(1).max(255),
  steps: z.array(CreateReminderStepInputSchema).min(1),
});
export type CreateReminderInput = z.infer<typeof CreateReminderInputSchema>;

export const UpdateReminderInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  is_active: z.boolean().optional(),
  steps: z.array(CreateReminderStepInputSchema).min(1).optional(),
});
export type UpdateReminderInput = z.infer<typeof UpdateReminderInputSchema>;

export const EnrollReminderInputSchema = z.object({
  ig_user_id: z.string().min(1),
  base_date: z.number().int(),
});
export type EnrollReminderInput = z.infer<typeof EnrollReminderInputSchema>;

// --- Ice Breakers (Task 25.1) ---

export const IceBreakerItemSchema = z.object({
  question: z.string().min(1).max(80),
  payload: z.string().min(1).max(1000),
});
export type IceBreakerItemInput = z.infer<typeof IceBreakerItemSchema>;

export const SetIceBreakersInputSchema = z.object({
  items: z.array(IceBreakerItemSchema).min(1).max(4),
});
export type SetIceBreakersInput = z.infer<typeof SetIceBreakersInputSchema>;

// --- Persistent Menu (Task 25.2) ---

export const PersistentMenuItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("web_url"),
    title: z.string().min(1).max(30),
    url: z.string().url().max(2000),
  }),
  z.object({
    type: z.literal("postback"),
    title: z.string().min(1).max(30),
    payload: z.string().min(1).max(1000),
  }),
]);
export type PersistentMenuItemInput = z.infer<typeof PersistentMenuItemSchema>;

export const SetPersistentMenuInputSchema = z.object({
  items: z.array(PersistentMenuItemSchema).min(1).max(5),
});
export type SetPersistentMenuInput = z.infer<typeof SetPersistentMenuInputSchema>;

// --- Test Mode (Task 26.1) ---

export const RegisterTestAccountInputSchema = z.object({
  ig_scoped_id: z.string().min(1),
});
export type RegisterTestAccountInput = z.infer<typeof RegisterTestAccountInputSchema>;

export const DryRunInputSchema = z.object({
  test_account_id: z.string().min(1),
});
export type DryRunInput = z.infer<typeof DryRunInputSchema>;

export const SimulateTriggerInputSchema = z.object({
  event_payload: z.object({
    type: TriggerTypeSchema,
    text: z.string().default(""),
  }),
});
export type SimulateTriggerInput = z.infer<typeof SimulateTriggerInputSchema>;

// --- Campaigns (時間指定配信・即時抽選・後日抽選) ---

export const CampaignKindSchema = z.enum(["scheduled_dm", "instant_win", "deferred_lottery"]);
export type CampaignKind = z.infer<typeof CampaignKindSchema>;

export const CampaignStatusSchema = z.enum([
  "draft", "scheduled", "active", "drawing", "selection_pending",
  "dispatching", "completed", "cancelled", "paused",
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const CampaignDispatchKindSchema = z.enum(["broadcast", "winner", "loser", "entry_confirm"]);
export type CampaignDispatchKind = z.infer<typeof CampaignDispatchKindSchema>;

export const CampaignDispatchChannelSchema = z.enum(["dm", "private_reply"]);
export type CampaignDispatchChannel = z.infer<typeof CampaignDispatchChannelSchema>;

export const CampaignDispatchStatusSchema = z.enum(["pending", "queued", "sent", "skipped", "failed", "cancelled"]);
export type CampaignDispatchStatus = z.infer<typeof CampaignDispatchStatusSchema>;

export const CampaignEntryResultSchema = z.enum(["pending", "win", "lose", "duplicate", "ineligible"]);
export type CampaignEntryResult = z.infer<typeof CampaignEntryResultSchema>;

export const SelectionMethodSchema = z.enum(["probability", "random", "manual"]);
export type SelectionMethod = z.infer<typeof SelectionMethodSchema>;

export const CreateCampaignInputSchema = z.object({
  name: z.string().min(1).max(255),
  kind: CampaignKindSchema,
  audience_filter: SegmentFilterSchema.nullable().default(null),
  message_template_id: z.string().nullable().default(null),
  scheduled_at: z.number().int().nullable().default(null),
  entry_start_at: z.number().int().nullable().default(null),
  entry_end_at: z.number().int().nullable().default(null),
  selection_method: SelectionMethodSchema.nullable().default(null),
  win_probability: z.number().min(0).max(100).nullable().default(null),
  winner_limit: z.number().int().min(1).nullable().default(null),
  winner_template_id: z.string().nullable().default(null),
  loser_template_id: z.string().nullable().default(null),
  winner_actions: z.array(TriggerActionSchema).default([]),
  loser_actions: z.array(TriggerActionSchema).default([]),
  entry_confirm_enabled: z.boolean().default(false),
  entry_confirm_template_id: z.string().nullable().default(null),
  duplicate_action: z.enum(["ignore", "send_message"]).default("ignore"),
}).superRefine((data, ctx) => {
  if (data.kind === "scheduled_dm" && data.scheduled_at) {
    if (data.scheduled_at % 300 !== 0) {
      ctx.addIssue({ code: "custom", message: "scheduled_at must be in 5-minute increments", path: ["scheduled_at"] });
    }
  }
  if (data.entry_start_at && data.entry_end_at) {
    if (data.entry_end_at - data.entry_start_at > 7 * 86400) {
      ctx.addIssue({ code: "custom", message: "Entry period must be within 7 days", path: ["entry_end_at"] });
    }
  }
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignInputSchema>;

export const UpdateCampaignInputSchema = CreateCampaignInputSchema.innerType().partial().extend({
  version: z.number().int(),
});
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignInputSchema>;
