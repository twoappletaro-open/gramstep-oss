export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  SEND_QUEUE: Queue;
  DLQ: Queue;
  R2: R2Bucket;
  DRIP_WORKFLOW: Workflow;
  META_API_VERSION: string;
  WEBHOOK_VERIFY_TOKEN: string;
  META_APP_SECRET: string;
  ENCRYPTION_KEY: string;
  META_APP_ID: string;
  DASHBOARD_URL: string;
  JWT_SECRET: string;
  REFRESH_SECRET: string;
  SLO_NOTIFY_WEBHOOK_URL: string;
}
