export interface Account {
  id: string;
  ig_user_id: string;
  ig_username: string | null;
  access_token_encrypted: string;
  token_expires_at: number;
  timezone: string;
  settings: string;
  health_score: string;
  created_at: number;
  updated_at: number;
}

export interface IgUser {
  id: string;
  account_id: string;
  ig_scoped_id: string;
  ig_username: string | null;
  display_name: string | null;
  follower_status: string | null;
  is_opted_out: number;
  is_blocked: number;
  is_deleted: number;
  score: number;
  metadata: string;
  profile_image_r2_key: string | null;
  timezone: string | null;
  preferred_delivery_hour: number | null;
  created_at: number;
  last_interaction_at: number | null;
  block_error_count: number;
  block_retry_at: number | null;
  updated_at: number;
}

export interface MessagingWindow {
  id: string;
  account_id: string;
  ig_user_id: string;
  window_opened_at: number;
  window_expires_at: number;
  is_active: number;
  re_engagement_sent: number;
}

export interface Tag {
  id: string;
  account_id: string;
  name: string;
  created_at: number;
}

export interface IgUserTag {
  ig_user_id: string;
  tag_id: string;
  created_at: number;
}

export interface Scenario {
  id: string;
  account_id: string;
  name: string;
  trigger_type: string;
  trigger_config: string;
  is_active: number;
  bot_disclosure_enabled: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface ScenarioStep {
  id: string;
  scenario_id: string;
  step_order: number;
  delay_seconds: number;
  absolute_datetime: number | null;
  message_type: string;
  message_payload: string;
  condition_config: string | null;
  created_at: number;
}

export interface ScenarioEnrollment {
  id: string;
  scenario_id: string;
  ig_user_id: string;
  account_id: string;
  current_step_order: number;
  workflow_instance_id: string | null;
  status: string;
  started_at: number;
  completed_at: number | null;
}

export interface WebhookEvent {
  event_id: string;
  account_id: string;
  event_type: string;
  processed_at: number;
}

export interface MessageLog {
  id: string;
  account_id: string;
  ig_user_id: string;
  direction: string;
  message_type: string;
  content: string | null;
  source_type: string;
  source_id: string | null;
  delivery_status: string;
  ig_message_id: string | null;
  media_r2_key: string | null;
  is_test: number;
  is_deleted: number;
  created_at: number;
}

export interface Operator {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  totp_secret: string | null;
  totp_enabled: number;
  created_at: number;
}

export interface AuditLog {
  id: string;
  operator_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: string | null;
  created_at: number;
}

export interface WorkflowCheckpoint {
  id: string;
  enrollment_id: string;
  scenario_id: string;
  account_id: string;
  ig_user_id: string;
  next_step_order: number;
  resume_at: number;
  status: string;
  created_at: number;
}

export interface ScoringRule {
  id: string;
  account_id: string;
  event_type: string;
  score_delta: number;
  is_active: number;
  created_at: number;
}

export interface AttachmentCache {
  id: string;
  account_id: string;
  media_url_hash: string;
  attachment_id: string;
  created_at: number;
}

export interface TestAccount {
  id: string;
  account_id: string;
  ig_scoped_id: string;
  created_at: number;
}

export interface DeletedUser {
  id: string;
  account_id: string;
  ig_user_id: string;
  ig_scoped_id: string;
  requested_at: number;
  physical_deleted_at: number | null;
  status: string;
}

export interface OperatorAccountAccess {
  operator_id: string;
  account_id: string;
}

export interface Trigger {
  id: string;
  account_id: string;
  name: string;
  trigger_type: string;
  match_type: string;
  keywords: string;
  actions: string;
  schedule_config: string | null;
  fire_mode: string;
  is_active: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface TriggerFireLog {
  id: string;
  trigger_id: string;
  ig_user_id: string;
  fired_at: number;
}

export interface PrivateReplySent {
  id: string;
  account_id: string;
  comment_id: string;
  ig_user_id: string;
  sent_at: number;
}

export interface CommentDmLimit {
  id: string;
  account_id: string;
  ig_user_id: string;
  sent_at: number;
}

export interface Template {
  id: string;
  account_id: string;
  name: string;
  type: string;
  body: string;
  variables: string;
  version: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface Broadcast {
  id: string;
  account_id: string;
  name: string;
  template_id: string;
  segment: string;
  status: string;
  scheduled_at: number | null;
  total_recipients: number;
  sent_count: number;
  skipped_count: number;
  failed_count: number;
  created_at: number;
  completed_at: number | null;
}

export interface NotificationRule {
  id: string;
  account_id: string;
  name: string;
  event_type: string;
  level: string;
  channels: string;
  webhook_url: string | null;
  email_to: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface Notification {
  id: string;
  account_id: string;
  rule_id: string | null;
  event_type: string;
  level: string;
  title: string;
  body: string;
  is_read: number;
  created_at: number;
}

export interface HealthLog {
  id: string;
  account_id: string;
  score: string;
  api_error_rate: number;
  rate_limit_hit_count: number;
  policy_violation_count: number;
  calculated_at: number;
}

export interface Form {
  id: string;
  account_id: string;
  name: string;
  is_active: number;
  completion_template_id: string | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface FormStep {
  id: string;
  form_id: string;
  step_order: number;
  question_text: string;
  quick_replies: string;
  metadata_key: string | null;
  field_type: string;
  field_key: string | null;
  answer_mode: string;
  options_json: string;
  created_at: number;
}

export interface FormSession {
  id: string;
  form_id: string;
  ig_user_id: string;
  account_id: string;
  current_step_order: number;
  status: string;
  started_at: number;
  completed_at: number | null;
  updated_at: number;
}

export interface FormAnswer {
  id: string;
  session_id: string;
  form_id: string;
  step_id: string;
  ig_user_id: string;
  account_id: string;
  step_order: number;
  answer_value: string;
  answer_label: string | null;
  answered_at: number;
}

export interface AbTest {
  id: string;
  account_id: string;
  template_id: string;
  name: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface AbTestVariant {
  id: string;
  ab_test_id: string;
  name: string;
  body: string;
  weight: number;
  sent_count: number;
  click_count: number;
  cv_count: number;
  created_at: number;
}

export interface AbTestEvent {
  id: string;
  variant_id: string;
  ig_user_id: string;
  event_type: string;
  created_at: number;
}

export interface CustomVariable {
  id: string;
  account_id: string;
  name: string;
  default_value: string;
  data_source: string;
  metadata_key: string | null;
  created_at: number;
  updated_at: number;
}

export interface OutgoingWebhook {
  id: string;
  account_id: string;
  name: string;
  url: string;
  secret: string;
  event_types: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface OutgoingWebhookLog {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string;
  status_code: number | null;
  response_body: string | null;
  success: number;
  attempted_at: number;
}

export interface IncomingWebhook {
  id: string;
  account_id: string;
  name: string;
  secret: string;
  actions: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface ConversionPoint {
  id: string;
  account_id: string;
  name: string;
  type: string;
  value: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface ConversionEvent {
  id: string;
  account_id: string;
  conversion_point_id: string;
  ig_user_id: string | null;
  scenario_id: string | null;
  value: number;
  metadata: string | null;
  created_at: number;
}

export interface ApiKey {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  key_hash: string;
  scopes: string;
  expires_at: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface TrackedLink {
  id: string;
  account_id: string;
  original_url: string;
  short_code: string;
  source_type: string;
  source_id: string | null;
  click_actions: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface LinkClick {
  id: string;
  tracked_link_id: string;
  account_id: string;
  ig_user_id: string | null;
  clicked_at: number;
}

export interface EntryRoute {
  id: string;
  account_id: string;
  ref_code: string;
  name: string;
  actions: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface EntryRouteEvent {
  id: string;
  entry_route_id: string;
  account_id: string;
  ig_user_id: string;
  ref_code: string;
  created_at: number;
}

export interface Reminder {
  id: string;
  account_id: string;
  name: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface ReminderStep {
  id: string;
  reminder_id: string;
  step_order: number;
  offset_seconds: number;
  message_type: string;
  message_payload: string;
  created_at: number;
}

export interface ReminderEnrollment {
  id: string;
  reminder_id: string;
  account_id: string;
  ig_user_id: string;
  base_date: number;
  status: string;
  enrolled_at: number;
  completed_at: number | null;
}

export interface ReminderDeliveryLog {
  id: string;
  enrollment_id: string;
  step_id: string;
  account_id: string;
  sent_at: number;
}

export interface IceBreaker {
  id: string;
  account_id: string;
  question: string;
  payload: string;
  position: number;
  is_synced: number;
  synced_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PersistentMenuItemRow {
  id: string;
  account_id: string;
  type: "web_url" | "postback";
  title: string;
  url: string | null;
  payload: string | null;
  position: number;
  is_synced: number;
  synced_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Campaign {
  id: string;
  account_id: string;
  kind: string;
  name: string;
  status: string;
  audience_filter: string | null;
  message_template_id: string | null;
  scheduled_at: number | null;
  entry_start_at: number | null;
  entry_end_at: number | null;
  selection_method: string | null;
  win_probability: number | null;
  winner_limit: number | null;
  remaining_winner_slots: number | null;
  winner_template_id: string | null;
  loser_template_id: string | null;
  winner_actions: string;
  loser_actions: string;
  entry_confirm_enabled: number;
  entry_confirm_template_id: string | null;
  duplicate_action: string;
  lock_token: string | null;
  locked_at: number | null;
  version: number;
  started_at: number | null;
  completed_at: number | null;
  paused_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface CampaignEntry {
  id: string;
  campaign_id: string;
  account_id: string;
  ig_user_id: string;
  source_trigger_id: string | null;
  source_comment_id: string | null;
  source_comment_created_at: number | null;
  result: string;
  result_reason: string | null;
  selected_at: number | null;
  created_at: number;
}

export interface CampaignDispatch {
  id: string;
  campaign_id: string;
  account_id: string;
  ig_user_id: string;
  recipient_id: string;
  dispatch_kind: string;
  channel: string;
  comment_id: string | null;
  message_payload: string;
  status: string;
  skip_reason: string | null;
  queued_at: number | null;
  sent_at: number | null;
  failed_at: number | null;
  error_message: string | null;
  created_at: number;
}
