interface BootstrapDemoInput {
  db: D1Database;
  r2: R2Bucket;
  accountId: string;
  operatorId: string;
  workerOrigin: string;
  dashboardUrl: string;
  now: number;
}

interface DemoSeedSummary {
  users: number;
  templates: number;
  scenarios: number;
  triggers: number;
  automations: number;
  campaigns: number;
  surveys: number;
}

type BindValue = string | number | null;

async function run(db: D1Database, sql: string, ...bindings: BindValue[]): Promise<void> {
  await db.prepare(sql).bind(...bindings).run();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function inferContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

async function mirrorDemoAssetToR2(input: {
  r2: R2Bucket;
  accountId: string;
  workerOrigin: string;
  sourceUrl: string;
  targetFilename: string;
}): Promise<string> {
  const response = await fetch(input.sourceUrl, { cf: { cacheTtl: 0, cacheEverything: false } });
  if (!response.ok) {
    throw new Error(`Failed to fetch demo asset: ${input.sourceUrl} (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const r2Key = `media/${input.accountId}/send/${input.targetFilename}`;
  await input.r2.put(r2Key, buffer, {
    httpMetadata: {
      contentType: response.headers.get("content-type") ?? inferContentType(input.targetFilename),
    },
  });

  return `${input.workerOrigin}/api/media/${r2Key}`;
}

export async function seedDemoData(input: BootstrapDemoInput): Promise<DemoSeedSummary> {
  const { db, r2, accountId, operatorId, workerOrigin, dashboardUrl, now } = input;
  const hour = 3600;
  const day = 86400;
  const demoAssetVersion = "20260402-12";
  const normalizedDashboardUrl = dashboardUrl.replace(/\/$/, "");
  const demoStaticImageBaseUrl = `${normalizedDashboardUrl}/demo`;
  const demoStaticImageSourceUrl = (slug: string, ext = "png") =>
    `${demoStaticImageBaseUrl}/${slug}.${ext}?v=${demoAssetVersion}`;
  const demoAdminUrl = `${normalizedDashboardUrl}/ja`;
  const demoAssetUrls = await (async () => {
    const assetSpecs = [
      {
        key: "hero",
        sourceUrl: demoStaticImageSourceUrl("initial-demo-hero"),
        targetFilename: `demo-initial-demo-hero-${demoAssetVersion}.png`,
      },
      {
        key: "firstDm",
        sourceUrl: `${normalizedDashboardUrl}/demo/initial-demo-dm-v3.jpg?v=${demoAssetVersion}`,
        targetFilename: `demo-initial-demo-dm-v3-${demoAssetVersion}.jpg`,
      },
      {
        key: "survey",
        sourceUrl: `${normalizedDashboardUrl}/demo/initial-demo-survey.png?v=${demoAssetVersion}`,
        targetFilename: `demo-initial-demo-survey-${demoAssetVersion}.png`,
      },
      {
        key: "booking",
        sourceUrl: `${normalizedDashboardUrl}/demo/initial-demo-booking.png?v=${demoAssetVersion}`,
        targetFilename: `demo-initial-demo-booking-${demoAssetVersion}.png`,
      },
    ] as const;

    const results = await Promise.all(assetSpecs.map(async (asset) => {
      try {
        const url = await mirrorDemoAssetToR2({
          r2,
          accountId,
          workerOrigin,
          sourceUrl: asset.sourceUrl,
          targetFilename: asset.targetFilename,
        });
        return [asset.key, url] as const;
      } catch {
        return [asset.key, asset.sourceUrl] as const;
      }
    }));

    return Object.fromEntries(results) as Record<(typeof assetSpecs)[number]["key"], string>;
  })();

  const settings = {
    delivery_window_start: 9,
    delivery_window_end: 23,
    re_engagement_enabled: true,
    opt_out_keywords: ["停止", "解除", "stop"],
    weekly_broadcast_limit: null,
    no_response_skip_threshold: 3,
    sync_policy: "none",
    app_review: {
      privacy_policy_url: `${workerOrigin}/privacy-policy`,
      purpose_description: "Instagram DMの自動応答、アンケート取得、抽選キャンペーン、有人対応の初期動作確認用サンプル設定です。",
      verification_steps: [
        "1. 左メニューのパッケージで「フォロワー限定特典」「未フォロー向けフォロー案内」を確認",
        "2. トリガーで「資料」「相談」「抽選」「フォロー特典」キーワード導線を確認",
        "3. アンケート「無料プレゼント希望アンケート」を開始して回答を確認",
        "4. キャンペーン一覧で時間指定配信・即時抽選・後日抽選の3種類を確認",
        "5. ユーザー一覧と分析画面で会話ログ、クリック、CVのサンプル値を確認",
      ].join("\n"),
      human_agent_status: "not_requested",
    },
  };

  await run(
    db,
    "UPDATE accounts SET settings = ?, updated_at = ? WHERE id = ?",
    json(settings),
    now,
    accountId,
  );

  const tags = [
    { id: "tag_vip", name: "VIP見込み客" },
    { id: "tag_surveyed", name: "アンケート回答済み" },
    { id: "tag_campaign", name: "キャンペーン応募" },
    { id: "tag_consult", name: "相談希望" },
  ];
  for (const tag of tags) {
    await run(
      db,
      "INSERT OR IGNORE INTO tags (id, account_id, name, created_at) VALUES (?, ?, ?, ?)",
      tag.id,
      accountId,
      tag.name,
      now,
    );
  }

  const users = [
    {
      id: "usr_demo_hot",
      igScopedId: "17841400000000001",
      username: "demo_hot_lead",
      displayName: "山田 花子",
      followerStatus: "following",
      score: 42,
      metadata: {
        goal_theme: "自動化",
        current_channel: "Instagram",
        monthly_leads: "月11〜30件",
        want_asset: "無料相談",
        email: "hanako@example.com",
      },
      timezone: "Asia/Tokyo",
      preferredHour: 20,
      lastInteractionAt: now - (20 * 60),
      conversationStatus: "in_progress",
      customStatusLabel: "高温",
      controlMode: "human",
      tags: ["tag_vip", "tag_surveyed", "tag_consult", "tag_campaign"],
    },
    {
      id: "usr_demo_warm",
      igScopedId: "17841400000000002",
      username: "demo_warm_lead",
      displayName: "佐藤 美咲",
      followerStatus: "following",
      score: 18,
      metadata: {
        goal_theme: "販売",
        current_channel: "紹介",
        monthly_leads: "月1〜10件",
        want_asset: "導線チェックリスト",
      },
      timezone: "Asia/Tokyo",
      preferredHour: 19,
      lastInteractionAt: now - (2 * day),
      conversationStatus: "resolved",
      customStatusLabel: null,
      controlMode: "bot",
      tags: ["tag_surveyed"],
    },
    {
      id: "usr_demo_new",
      igScopedId: "17841400000000003",
      username: "demo_new_lead",
      displayName: "高橋 翼",
      followerStatus: "not_following",
      score: 6,
      metadata: {
        goal_theme: "",
        current_channel: "その他",
      },
      timezone: "Asia/Tokyo",
      preferredHour: 21,
      lastInteractionAt: now - (10 * 60),
      conversationStatus: "unread",
      customStatusLabel: null,
      controlMode: "bot",
      tags: [],
    },
  ];

  for (const user of users) {
    await run(
      db,
      `INSERT OR IGNORE INTO ig_users (
        id, account_id, ig_scoped_id, ig_username, display_name, follower_status,
        is_opted_out, is_blocked, is_deleted, score, metadata, profile_image_r2_key,
        timezone, preferred_delivery_hour, created_at, last_interaction_at,
        block_error_count, block_retry_at, updated_at, conversation_status,
        custom_status_label, assigned_operator_id, control_mode
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, NULL, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)`,
      user.id,
      accountId,
      user.igScopedId,
      user.username,
      user.displayName,
      user.followerStatus,
      user.score,
      json(user.metadata),
      user.timezone,
      user.preferredHour,
      now - (14 * day),
      user.lastInteractionAt,
      now,
      user.conversationStatus,
      user.customStatusLabel,
      operatorId,
      user.controlMode,
    );

    for (const tagId of user.tags) {
      await run(
        db,
        "INSERT OR IGNORE INTO ig_user_tags (ig_user_id, tag_id, created_at) VALUES (?, ?, ?)",
        user.id,
        tagId,
        now,
      );
    }
  }

  const windows = [
    { id: "mw_demo_hot", userId: "usr_demo_hot", openedAt: now - hour, expiresAt: now + (23 * hour), active: 1 },
    { id: "mw_demo_warm", userId: "usr_demo_warm", openedAt: now - (30 * hour), expiresAt: now - (6 * hour), active: 0 },
    { id: "mw_demo_new", userId: "usr_demo_new", openedAt: now - (20 * 60), expiresAt: now + (23 * hour), active: 1 },
  ];
  for (const window of windows) {
    await run(
      db,
      `INSERT OR REPLACE INTO messaging_windows
       (id, account_id, ig_user_id, window_opened_at, window_expires_at, is_active, re_engagement_sent)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      window.id,
      accountId,
      window.userId,
      window.openedAt,
      window.expiresAt,
      window.active,
    );
  }

  const customVariables = [
    { id: "cv_goal_theme", name: "goal_theme", defaultValue: "", dataSource: "metadata", metadataKey: "goal_theme" },
    { id: "cv_current_channel", name: "current_channel", defaultValue: "", dataSource: "metadata", metadataKey: "current_channel" },
    { id: "cv_monthly_leads", name: "monthly_leads", defaultValue: "", dataSource: "metadata", metadataKey: "monthly_leads" },
    { id: "cv_want_asset", name: "want_asset", defaultValue: "", dataSource: "metadata", metadataKey: "want_asset" },
  ];
  for (const variable of customVariables) {
    await run(
      db,
      `INSERT OR IGNORE INTO custom_variables
       (id, account_id, name, default_value, data_source, metadata_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      variable.id,
      accountId,
      variable.name,
      variable.defaultValue,
      variable.dataSource,
      variable.metadataKey,
      now,
      now,
    );
  }

  const templates = [
    {
      id: "tpl_demo_welcome",
      name: "初回案内メッセージ",
      type: "text",
      body: "こんにちは {{display_name}}さん。資料希望なら「資料」、相談希望なら「相談」と送ってください。",
    },
    {
      id: "tpl_demo_consult",
      name: "無料相談案内",
      type: "text",
      body: "{{display_name}}さん向けに、Instagram導線の無料相談枠をご案内できます。希望なら「予約」と返信してください。",
    },
    {
      id: "tpl_demo_reservation_confirm",
      name: "無料相談予約受付",
      type: "text",
      body: "{{display_name}}さん、無料相談の予約希望を受け付けました。希望日程をこのまま返信してください。",
    },
    {
      id: "tpl_demo_reservation_received",
      name: "無料相談希望日程受付",
      type: "text",
      body: "{{display_name}}さん、希望日程ありがとうございます。内容を確認してご案内します。",
    },
    {
      id: "tpl_demo_reservation_closing",
      name: "予約導線デモ終了案内",
      type: "generic",
      body: json({
        elements: [
          {
            title: "デモはここまでです",
            subtitle: "GitHub から GramStep OSS を始められます。",
            image_url: demoAssetUrls.hero,
            default_action: {
              type: "web_url",
              url: "https://twoappletaro-open.github.io/gramstep-oss/",
            },
            buttons: [
              {
                type: "web_url",
                title: "GitHubを見る",
                url: "https://twoappletaro-open.github.io/gramstep-oss/",
              },
            ],
          },
        ],
      }),
    },
    {
      id: "tpl_demo_survey_thanks",
      name: "アンケート完了お礼",
      type: "text",
      body: "ご回答ありがとうございます。内容に合わせて次におすすめの資料をお送りします。",
    },
    {
      id: "tpl_demo_campaign_win",
      name: "抽選当選メッセージ",
      type: "text",
      body: "おめでとうございます。当選です。特典受け取り案内をこのままお送りします。",
    },
    {
      id: "tpl_demo_campaign_lose",
      name: "抽選落選フォロー",
      type: "text",
      body: "今回は対象外でしたが、代わりに使えるチェックリストをご案内します。",
    },
    {
      id: "tpl_demo_quickreply",
      name: "資料請求クイックリプライ",
      type: "quick_reply",
      body: json({
        text: "受け取りたい内容を選んでください",
        quick_replies: [
          { content_type: "text", title: "導線チェック", payload: "OFFER_CHECKLIST" },
          { content_type: "text", title: "配信設計", payload: "OFFER_FLOW" },
          { content_type: "text", title: "無料相談", payload: "OFFER_CONSULT" },
        ],
      }),
    },
    {
      id: "pkg_demo_entry",
      name: "フォロワー条件デモパッケージ",
      type: "quick_reply",
      body: json({
        version: 1,
        kind: "package",
        text: "{{display_name}}さん、受け取りたい案内を選んでください。",
        buttons: [
          {
            id: "btn_follow_offer",
            label: "フォロー特典",
            action: {
              type: "send_message",
              selectionMode: "follower_condition",
              useFollowerCondition: true,
              followerPackageId: "pkg_demo_following_offer",
              nonFollowerPackageId: "pkg_demo_non_following_offer",
            },
          },
          {
            id: "btn_consult",
            label: "無料相談",
            action: {
              type: "send_message",
              selectionMode: "specific",
              useFollowerCondition: false,
              packageId: "pkg_demo_consult",
            },
          },
        ],
      }),
    },
    {
      id: "pkg_demo_following_offer",
      name: "フォロワー限定特典パッケージ",
      type: "quick_reply",
      body: json({
        version: 1,
        kind: "package",
        text: "{{display_name}}さんはフォロワー確認済みです。限定特典として配信設計テンプレート集をご案内します。",
        buttons: [
          {
            id: "btn_offer_consult",
            label: "無料相談へ進む",
            action: {
              type: "send_message",
              selectionMode: "specific",
              useFollowerCondition: false,
              packageId: "pkg_demo_consult",
            },
          },
          {
            id: "btn_offer_more",
            label: "別の案内を見る",
            action: {
              type: "send_message",
              selectionMode: "specific",
              useFollowerCondition: false,
              packageId: "pkg_demo_survey_followup",
            },
          },
        ],
      }),
    },
    {
      id: "pkg_demo_non_following_offer",
      name: "未フォロー向け案内パッケージ",
      type: "quick_reply",
      body: json({
        version: 1,
        kind: "package",
        text: "{{display_name}}さん、この特典はフォロワー向けです。先にフォローしてから、下の「特典を再確認」を押してください。",
        buttons: [
          {
            id: "btn_retry_follow_offer",
            label: "特典を再確認",
            action: {
              type: "send_message",
              selectionMode: "follower_condition",
              useFollowerCondition: true,
              followerPackageId: "pkg_demo_following_offer",
              nonFollowerPackageId: "pkg_demo_non_following_offer",
            },
          },
        ],
      }),
    },
    {
      id: "pkg_demo_consult",
      name: "無料相談案内パッケージ",
      type: "text",
      body: json({
        version: 1,
        kind: "package",
        text: "{{display_name}}さん向けに、Instagram導線の無料相談枠をご案内できます。希望なら「予約」と返信してください。",
        buttons: [],
      }),
    },
    {
      id: "pkg_demo_survey_followup",
      name: "アンケート完了後フォローアップ",
      type: "quick_reply",
      body: json({
        version: 1,
        kind: "package",
        text: "{{display_name}}さん、ご回答ありがとうございます。続けて受け取りたい案内を選んでください。",
        buttons: [
          {
            id: "btn_follow_offer",
            label: "フォロー特典",
            action: {
              type: "send_message",
              selectionMode: "follower_condition",
              useFollowerCondition: true,
              followerPackageId: "pkg_demo_following_offer",
              nonFollowerPackageId: "pkg_demo_non_following_offer",
            },
          },
          {
            id: "btn_consult",
            label: "無料相談",
            action: {
              type: "send_message",
              selectionMode: "specific",
              useFollowerCondition: false,
              packageId: "pkg_demo_consult",
            },
          },
        ],
      }),
    },
  ];
  for (const template of templates) {
    await run(
      db,
      `INSERT INTO templates
       (id, account_id, name, type, body, variables, version, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', 1, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         body = excluded.body,
         variables = excluded.variables,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
      template.id,
      accountId,
      template.name,
      template.type,
      template.body,
      now,
      now,
    );
  }

  const scenarios = [
    {
      id: "scn_demo_first_dm",
      name: "初回DMデモ",
      triggerType: "dm",
      steps: [
        {
          id: "scn_demo_first_dm_step1",
          order: 1,
          delay: 0,
          type: "rich_menu",
          payload: json({
            type: "rich_menu",
            image_aspect_ratio: "square",
            elements: [
              {
                title: "gramstep 初回DMデモ",
                subtitle: "{{display_name}}さん向けに、初回DMから予約導線までを3分で体験できます。",
                image_url: demoAssetUrls.hero,
                default_action: { type: "web_url", url: demoAdminUrl },
                buttons: [],
              },
            ],
          }),
        },
        {
          id: "scn_demo_first_dm_step2",
          order: 2,
          delay: 0,
          type: "rich_menu",
          payload: json({
            type: "rich_menu",
            image_aspect_ratio: "square",
            elements: [
              {
                title: "初回DMデモ",
                subtitle: "右にスワイプして、初回DM・アンケート・予約導線の流れを確認できます。",
                default_action: { type: "web_url", url: demoAdminUrl },
                buttons: [
                  { type: "postback", title: "デモを再開", payload: "デモ" },
                ],
              },
              {
                title: "初回DM",
                subtitle: "第一印象で興味を作り、会話を始める",
                image_url: demoAssetUrls.firstDm,
                default_action: { type: "web_url", url: demoAdminUrl },
                buttons: [
                  { type: "postback", title: "デモを再開", payload: "デモ" },
                ],
              },
              {
                title: "アンケート",
                subtitle: "回答内容でタグと温度感を取得する",
                image_url: demoAssetUrls.survey,
                default_action: { type: "web_url", url: demoAdminUrl },
                buttons: [
                  { type: "postback", title: "無料診断", payload: "START_MARKETING_SURVEY" },
                ],
              },
              {
                title: "予約導線",
                subtitle: "希望日程の回収まで自然につなぐ",
                image_url: demoAssetUrls.booking,
                default_action: { type: "web_url", url: demoAdminUrl },
                buttons: [
                  { type: "postback", title: "相談予約", payload: "予約" },
                ],
              },
            ],
          }),
        },
        {
          id: "scn_demo_first_dm_step3",
          order: 3,
          delay: 0,
          type: "quick_reply",
          payload: json({
            type: "quick_reply",
            text: "次にアンケートのデモをお見せします。無料診断アンケートか資料導線を選んでください。",
            quick_replies: [
              { content_type: "text", title: "無料診断", payload: "START_MARKETING_SURVEY" },
              { content_type: "text", title: "資料を見る", payload: "資料" },
              { content_type: "text", title: "また後で", payload: "LATER_DEMO" },
            ],
          }),
        },
      ],
    },
    {
      id: "scn_demo_welcome",
      name: "資料請求フォロー",
      triggerType: "dm",
      steps: [
        {
          id: "scn_demo_welcome_step1",
          order: 1,
          delay: 0,
          type: "text",
          payload: json({ type: "text", text: "資料リクエストありがとうございます。まず現状を1分で把握したいので、次の質問に答えてください。" }),
        },
        {
          id: "scn_demo_welcome_step2",
          order: 2,
          delay: 300,
          type: "quick_reply",
          payload: json({
            type: "quick_reply",
            text: "今いちばん強化したいのはどれですか？",
            quick_replies: [
              { content_type: "text", title: "集客", payload: "GOAL_TRAFFIC" },
              { content_type: "text", title: "教育", payload: "GOAL_NURTURE" },
              { content_type: "text", title: "販売", payload: "GOAL_SALES" },
            ],
          }),
        },
      ],
    },
    {
      id: "scn_demo_consult",
      name: "相談希望者フォロー",
      triggerType: "dm",
      steps: [
        {
          id: "scn_demo_consult_step1",
          order: 1,
          delay: 0,
          type: "text",
          payload: json({ type: "text", text: "ご相談ありがとうございます。無料相談の概要と流れをこのままご案内します。" }),
        },
        {
          id: "scn_demo_consult_step2",
          order: 2,
          delay: 86400,
          type: "text",
          payload: json({ type: "text", text: "前日のリマインドです。まだ予約前なら、今の課題を一言で返信してください。" }),
        },
      ],
    },
  ];
  for (const scenario of scenarios) {
    await run(
      db,
      `INSERT INTO scenarios
       (id, account_id, name, trigger_type, trigger_config, is_active, bot_disclosure_enabled, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', 1, 0, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         trigger_type = excluded.trigger_type,
         trigger_config = excluded.trigger_config,
         is_active = excluded.is_active,
         bot_disclosure_enabled = excluded.bot_disclosure_enabled,
         updated_at = excluded.updated_at`,
      scenario.id,
      accountId,
      scenario.name,
      scenario.triggerType,
      now,
      now,
    );

    for (const step of scenario.steps) {
      await run(
        db,
        `INSERT INTO scenario_steps
         (id, scenario_id, step_order, delay_seconds, absolute_datetime, message_type, message_payload, condition_config, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           step_order = excluded.step_order,
           delay_seconds = excluded.delay_seconds,
           absolute_datetime = excluded.absolute_datetime,
           message_type = excluded.message_type,
           message_payload = excluded.message_payload,
           condition_config = excluded.condition_config`,
        step.id,
        scenario.id,
        step.order,
        step.delay,
        step.type,
        step.payload,
        now,
      );
    }
  }

  const surveyId = "srv_demo_marketing";
  await run(
    db,
    `INSERT OR IGNORE INTO forms
     (id, account_id, name, is_active, completion_template_id, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, NULL, ?, ?)`,
    surveyId,
    accountId,
    "無料プレゼント希望アンケート",
    "pkg_demo_survey_followup",
    now,
    now,
  );

  const surveySteps = [
    {
      id: "srv_demo_step1",
      order: 1,
      fieldType: "custom_attribute",
      fieldKey: "goal_theme",
      answerMode: "choice",
      question: "今いちばん強化したいテーマを選んでください",
      options: [
        { label: "集客", value: "集客" },
        { label: "教育", value: "教育" },
        { label: "販売", value: "販売" },
        { label: "自動化", value: "自動化" },
      ],
    },
    {
      id: "srv_demo_step2",
      order: 2,
      fieldType: "custom_attribute",
      fieldKey: "current_channel",
      answerMode: "choice",
      question: "今の集客導線でいちばん使っているものは？",
      options: [
        { label: "Instagram", value: "Instagram" },
        { label: "広告", value: "広告" },
        { label: "紹介", value: "紹介" },
        { label: "その他", value: "その他" },
      ],
    },
    {
      id: "srv_demo_step3",
      order: 3,
      fieldType: "custom_attribute",
      fieldKey: "monthly_leads",
      answerMode: "choice",
      question: "月あたりの見込み客数に近いものを選んでください",
      options: [
        { label: "まだほぼない", value: "まだほぼない" },
        { label: "月1〜10件", value: "月1〜10件" },
        { label: "月11〜30件", value: "月11〜30件" },
        { label: "月31件以上", value: "月31件以上" },
      ],
    },
    {
      id: "srv_demo_step4",
      order: 4,
      fieldType: "custom_attribute",
      fieldKey: "want_asset",
      answerMode: "choice",
      question: "受け取りたい特典を選んでください",
      options: [
        { label: "導線チェック", value: "導線チェックリスト" },
        { label: "配信設計", value: "配信設計テンプレ" },
        { label: "無料相談", value: "無料相談" },
      ],
    },
    {
      id: "srv_demo_step5",
      order: 5,
      fieldType: "default_attribute",
      fieldKey: "email",
      answerMode: "free_text",
      question: "資料送付先メールアドレスを入力してください",
      options: [],
    },
  ];
  for (const step of surveySteps) {
    await run(
      db,
      `INSERT OR IGNORE INTO form_steps
       (id, form_id, step_order, question_text, quick_replies, metadata_key, field_type, field_key, answer_mode, options_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      step.id,
      surveyId,
      step.order,
      step.question,
      json(step.options.map((option) => ({ title: option.label, payload: option.value, metadata_key: step.fieldKey ?? undefined }))),
      step.fieldKey,
      step.fieldType,
      step.fieldKey,
      step.answerMode,
      json(step.options),
      now,
    );
  }

  const sessionId = "srv_demo_session_1";
  await run(
    db,
    `INSERT OR IGNORE INTO form_sessions
     (id, form_id, ig_user_id, account_id, current_step_order, status, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, 5, 'completed', ?, ?, ?)`,
    sessionId,
    surveyId,
    "usr_demo_hot",
    accountId,
    now - day,
    now - day + 900,
    now - day + 900,
  );

  const surveyAnswers = [
    { id: "srv_demo_answer1", stepId: "srv_demo_step1", order: 1, value: "自動化", label: "自動化" },
    { id: "srv_demo_answer2", stepId: "srv_demo_step2", order: 2, value: "Instagram", label: "Instagram" },
    { id: "srv_demo_answer3", stepId: "srv_demo_step3", order: 3, value: "月11〜30件", label: "月11〜30件" },
    { id: "srv_demo_answer4", stepId: "srv_demo_step4", order: 4, value: "無料相談", label: "無料相談" },
    { id: "srv_demo_answer5", stepId: "srv_demo_step5", order: 5, value: "hanako@example.com", label: "hanako@example.com" },
  ];
  for (const answer of surveyAnswers) {
    await run(
      db,
      `INSERT OR IGNORE INTO form_answers
       (id, session_id, form_id, step_id, ig_user_id, account_id, step_order, answer_value, answer_label, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      answer.id,
      sessionId,
      surveyId,
      answer.stepId,
      "usr_demo_hot",
      accountId,
      answer.order,
      answer.value,
      answer.label,
      now - day + (answer.order * 60),
    );
  }

  const triggers = [
    {
      id: "trg_demo_first_dm",
      name: "初回DMデモ開始",
      type: "dm",
      matchType: "exact",
      keywords: ["START_FIRST_DM_DEMO"],
      fireMode: "first_only",
      actions: [
        { type: "enroll_scenario", scenarioId: "scn_demo_first_dm" },
      ],
    },
    {
      id: "trg_demo_first_dm_restart",
      name: "初回DMデモ再開キーワード",
      type: "dm",
      matchType: "partial",
      keywords: ["デモ", "初回DM", "初回デモ"],
      fireMode: "unlimited",
      actions: [
        { type: "enroll_scenario", scenarioId: "scn_demo_first_dm" },
      ],
    },
    {
      id: "trg_demo_first_dm_menu",
      name: "初回DMデモメニュー開始",
      type: "ice_breaker",
      matchType: "partial",
      keywords: [],
      fireMode: "unlimited",
      actions: [
        { type: "enroll_scenario", scenarioId: "scn_demo_first_dm" },
      ],
    },
    {
      id: "trg_demo_survey_entry",
      name: "無料診断アンケート開始",
      type: "dm",
      matchType: "exact",
      keywords: ["START_MARKETING_SURVEY"],
      fireMode: "once",
      actions: [
        { type: "add_tag", tagId: "tag_consult" },
        { type: "update_score", delta: 8 },
        { type: "start_survey", surveyId },
      ],
    },
    {
      id: "trg_demo_material",
      name: "資料請求キーワード",
      type: "dm",
      matchType: "partial",
      keywords: ["資料", "特典", "プレゼント"],
      fireMode: "unlimited",
      actions: [
        { type: "send_template", templateId: "tpl_demo_quickreply" },
      ],
    },
    {
      id: "trg_demo_offer_checklist",
      name: "資料導線チェック選択",
      type: "dm",
      matchType: "exact",
      keywords: ["OFFER_CHECKLIST"],
      fireMode: "unlimited",
      actions: [
        { type: "add_tag", tagId: "tag_consult" },
        { type: "update_score", delta: 10 },
        { type: "update_metadata", key: "offer_interest", value: "導線チェック" },
        { type: "start_survey", surveyId },
      ],
    },
    {
      id: "trg_demo_offer_flow",
      name: "資料配信設計選択",
      type: "dm",
      matchType: "exact",
      keywords: ["OFFER_FLOW"],
      fireMode: "unlimited",
      actions: [
        { type: "add_tag", tagId: "tag_consult" },
        { type: "update_score", delta: 12 },
        { type: "update_metadata", key: "offer_interest", value: "配信設計" },
        { type: "start_survey", surveyId },
      ],
    },
    {
      id: "trg_demo_offer_consult",
      name: "資料無料相談選択",
      type: "dm",
      matchType: "exact",
      keywords: ["OFFER_CONSULT"],
      fireMode: "unlimited",
      actions: [
        { type: "add_tag", tagId: "tag_consult" },
        { type: "update_score", delta: 15 },
        { type: "update_metadata", key: "offer_interest", value: "無料相談" },
        { type: "start_survey", surveyId },
      ],
    },
    {
      id: "trg_demo_consult",
      name: "相談キーワード",
      type: "dm",
      matchType: "partial",
      keywords: ["相談", "詳細"],
      fireMode: "unlimited",
      actions: [
        { type: "enroll_scenario", scenarioId: "scn_demo_consult" },
        { type: "send_template", templateId: "tpl_demo_consult" },
      ],
    },
    {
      id: "trg_demo_consult_comment",
      name: "相談コメントキーワード",
      type: "comment",
      matchType: "partial",
      keywords: ["相談", "詳細"],
      fireMode: "unlimited",
      actions: [
        { type: "enroll_scenario", scenarioId: "scn_demo_consult" },
        { type: "send_template", templateId: "tpl_demo_consult" },
      ],
    },
    {
      id: "trg_demo_reservation",
      name: "無料相談予約キーワード",
      type: "dm",
      matchType: "partial",
      keywords: ["予約"],
      fireMode: "unlimited",
      actions: [
        { type: "add_tag", tagId: "tag_consult" },
        { type: "update_score", delta: 10 },
        { type: "update_metadata", key: "consult_status", value: "予約希望" },
        { type: "send_template", templateId: "tpl_demo_reservation_confirm" },
      ],
    },
    {
      id: "trg_demo_reservation_schedule",
      name: "無料相談希望日程受付",
      type: "dm",
      matchType: "regex",
      keywords: [
        "\\d{1,2}[/-]\\d{1,2}",
        "\\d{1,2}月\\d{1,2}日",
        "\\d{1,2}:\\d{2}",
        "\\d{1,2}時",
        "来週|今週|明日|明後日",
      ],
      fireMode: "once",
      actions: [
        { type: "update_metadata", key: "consult_status", value: "日程受領" },
        { type: "send_template", templateId: "tpl_demo_reservation_received" },
        { type: "send_template", templateId: "tpl_demo_reservation_closing" },
      ],
    },
    {
      id: "trg_demo_campaign",
      name: "抽選参加キーワード",
      type: "dm",
      matchType: "partial",
      keywords: ["抽選", "キャンペーン"],
      fireMode: "unlimited",
      actions: [
        { type: "enter_campaign", campaignId: "camp_demo_instant" },
        { type: "add_tag", tagId: "tag_campaign" },
      ],
    },
    {
      id: "trg_demo_follower_branch",
      name: "フォロワー条件パッケージデモ",
      type: "dm",
      matchType: "partial",
      keywords: ["フォロー特典", "限定特典"],
      fireMode: "unlimited",
      actions: [
        { type: "send_template", templateId: "pkg_demo_entry" },
      ],
    },
  ];
  for (const trigger of triggers) {
    await run(
      db,
      `INSERT INTO triggers
       (id, account_id, name, trigger_type, match_type, keywords, actions, schedule_config, fire_mode, is_active, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         trigger_type = excluded.trigger_type,
         match_type = excluded.match_type,
         keywords = excluded.keywords,
         actions = excluded.actions,
         schedule_config = excluded.schedule_config,
         fire_mode = excluded.fire_mode,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
      trigger.id,
      accountId,
      trigger.name,
      trigger.type,
      trigger.matchType,
      json(trigger.keywords),
      json(trigger.actions),
      trigger.fireMode,
      now,
      now,
    );
  }

  const automations = [
    {
      id: "aut_demo_vip",
      name: "VIP見込み客へ相談案内",
      conditionGroup: {
        logic: "and",
        conditions: [
          { field: "tag", operator: "has", value: "VIP見込み客" },
          { field: "score", operator: "gte", value: 30 },
        ],
      },
      actions: [
        { type: "send_template", templateId: "tpl_demo_consult" },
      ],
    },
    {
      id: "aut_demo_goal",
      name: "自動化関心タグ付け",
      conditionGroup: {
        logic: "and",
        conditions: [
          { field: "metadata", operator: "eq", key: "goal_theme", value: "自動化" },
        ],
      },
      actions: [
        { type: "add_tag", tagId: "tag_vip" },
        { type: "update_score", delta: 5 },
      ],
    },
  ];
  for (const automation of automations) {
    await run(
      db,
      `INSERT OR IGNORE INTO automation_rules
       (id, account_id, name, condition_group, actions, is_active, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      automation.id,
      accountId,
      automation.name,
      json(automation.conditionGroup),
      json(automation.actions),
      now,
      now,
    );
  }

  const campaigns = [
    {
      id: "camp_demo_scheduled",
      kind: "scheduled_dm",
      name: "春の無料相談案内",
      status: "draft",
      messageTemplateId: "tpl_demo_consult",
      scheduledAt: now + (2 * day),
      entryStartAt: null,
      entryEndAt: null,
      selectionMethod: null,
      winProbability: null,
      winnerLimit: null,
      remainingWinnerSlots: null,
      winnerTemplateId: null,
      loserTemplateId: null,
      entryConfirmEnabled: 0,
      entryConfirmTemplateId: null,
      duplicateAction: "ignore",
    },
    {
      id: "camp_demo_instant",
      kind: "instant_win",
      name: "DMキーワード即時抽選",
      status: "active",
      messageTemplateId: null,
      scheduledAt: null,
      entryStartAt: now - day,
      entryEndAt: now + (3 * day),
      selectionMethod: "probability",
      winProbability: 25,
      winnerLimit: 20,
      remainingWinnerSlots: 14,
      winnerTemplateId: "tpl_demo_campaign_win",
      loserTemplateId: "tpl_demo_campaign_lose",
      entryConfirmEnabled: 1,
      entryConfirmTemplateId: "tpl_demo_welcome",
      duplicateAction: "send_message",
    },
    {
      id: "camp_demo_lottery",
      kind: "deferred_lottery",
      name: "アンケート回答者プレゼント",
      status: "active",
      messageTemplateId: null,
      scheduledAt: null,
      entryStartAt: now - (2 * day),
      entryEndAt: now + (5 * day),
      selectionMethod: "random",
      winProbability: null,
      winnerLimit: 3,
      remainingWinnerSlots: 3,
      winnerTemplateId: "tpl_demo_campaign_win",
      loserTemplateId: "tpl_demo_campaign_lose",
      entryConfirmEnabled: 0,
      entryConfirmTemplateId: null,
      duplicateAction: "ignore",
    },
  ];
  for (const campaign of campaigns) {
    await run(
      db,
      `INSERT OR IGNORE INTO campaigns (
        id, account_id, kind, name, status, audience_filter, message_template_id, scheduled_at,
        entry_start_at, entry_end_at, selection_method, win_probability, winner_limit, remaining_winner_slots,
        winner_template_id, loser_template_id, winner_actions, loser_actions, entry_confirm_enabled,
        entry_confirm_template_id, duplicate_action, lock_token, locked_at, version, started_at, completed_at,
        paused_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, NULL, NULL, 1, NULL, NULL, NULL, ?, ?)`,
      campaign.id,
      accountId,
      campaign.kind,
      campaign.name,
      campaign.status,
      campaign.messageTemplateId,
      campaign.scheduledAt,
      campaign.entryStartAt,
      campaign.entryEndAt,
      campaign.selectionMethod,
      campaign.winProbability,
      campaign.winnerLimit,
      campaign.remainingWinnerSlots,
      campaign.winnerTemplateId,
      campaign.loserTemplateId,
      campaign.entryConfirmEnabled,
      campaign.entryConfirmTemplateId,
      campaign.duplicateAction,
      now,
      now,
    );
  }

  const campaignEntries = [
    { id: "cent_demo_1", campaignId: "camp_demo_instant", userId: "usr_demo_hot", result: "win", selectedAt: now - (3 * hour) },
    { id: "cent_demo_2", campaignId: "camp_demo_instant", userId: "usr_demo_warm", result: "lose", selectedAt: now - (3 * hour) },
    { id: "cent_demo_3", campaignId: "camp_demo_lottery", userId: "usr_demo_hot", result: "pending", selectedAt: null },
    { id: "cent_demo_4", campaignId: "camp_demo_lottery", userId: "usr_demo_warm", result: "pending", selectedAt: null },
  ];
  for (const entry of campaignEntries) {
    await run(
      db,
      `INSERT OR IGNORE INTO campaign_entries
       (id, campaign_id, account_id, ig_user_id, source_trigger_id, source_comment_id, source_comment_created_at, result, result_reason, selected_at, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)`,
      entry.id,
      entry.campaignId,
      accountId,
      entry.userId,
      entry.result,
      entry.selectedAt,
      now - (4 * hour),
    );
  }

  const dispatches = [
    {
      id: "cdsp_demo_1",
      campaignId: "camp_demo_instant",
      userId: "usr_demo_hot",
      recipientId: "17841400000000001",
      kind: "winner",
      payload: "抽選当選メッセージ",
      status: "sent",
    },
    {
      id: "cdsp_demo_2",
      campaignId: "camp_demo_instant",
      userId: "usr_demo_warm",
      recipientId: "17841400000000002",
      kind: "loser",
      payload: "抽選落選フォローメッセージ",
      status: "sent",
    },
  ];
  for (const dispatch of dispatches) {
    await run(
      db,
      `INSERT OR IGNORE INTO campaign_dispatches
       (id, campaign_id, account_id, ig_user_id, recipient_id, dispatch_kind, channel, comment_id, message_payload, status, skip_reason, queued_at, sent_at, failed_at, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'dm', NULL, ?, ?, NULL, ?, ?, NULL, NULL, ?)`,
      dispatch.id,
      dispatch.campaignId,
      accountId,
      dispatch.userId,
      dispatch.recipientId,
      dispatch.kind,
      dispatch.payload,
      dispatch.status,
      now - (3 * hour) - 60,
      now - (3 * hour),
      now - (3 * hour) - 60,
    );
  }

  const enrollments = [
    {
      id: "enr_demo_1",
      scenarioId: "scn_demo_consult",
      userId: "usr_demo_hot",
      currentStep: 2,
      status: "completed",
      startedAt: now - (2 * day),
      completedAt: now - day,
    },
    {
      id: "enr_demo_2",
      scenarioId: "scn_demo_welcome",
      userId: "usr_demo_warm",
      currentStep: 1,
      status: "window_expired",
      startedAt: now - (3 * day),
      completedAt: now - (2 * day),
    },
  ];
  for (const enrollment of enrollments) {
    await run(
      db,
      `INSERT OR IGNORE INTO scenario_enrollments
       (id, scenario_id, ig_user_id, account_id, current_step_order, workflow_instance_id, status, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      enrollment.id,
      enrollment.scenarioId,
      enrollment.userId,
      accountId,
      enrollment.currentStep,
      enrollment.status,
      enrollment.startedAt,
      enrollment.completedAt,
    );
  }

  const messages = [
    {
      id: "msg_demo_1",
      userId: "usr_demo_hot",
      direction: "inbound",
      type: "text",
      content: "無料相談ってまだ募集していますか？",
      sourceType: "webhook",
      sourceId: null,
      status: "read",
      createdAt: now - (2 * hour),
    },
    {
      id: "msg_demo_2",
      userId: "usr_demo_hot",
      direction: "outbound",
      type: "text",
      content: "はい、募集しています。まずは現状を教えてください。",
      sourceType: "manual",
      sourceId: null,
      status: "read",
      createdAt: now - hour,
    },
    {
      id: "msg_demo_3",
      userId: "usr_demo_warm",
      direction: "inbound",
      type: "text",
      content: "資料を見てみたいです",
      sourceType: "webhook",
      sourceId: null,
      status: "read",
      createdAt: now - (2 * day),
    },
    {
      id: "msg_demo_4",
      userId: "usr_demo_warm",
      direction: "outbound",
      type: "text",
      content: "ありがとうございます。こちらが資料導線です。",
      sourceType: "scenario",
      sourceId: "scn_demo_welcome",
      status: "delivered",
      createdAt: now - (2 * day) + 120,
    },
    {
      id: "msg_demo_5",
      userId: "usr_demo_warm",
      direction: "outbound",
      type: "text",
      content: "配信テストメッセージ",
      sourceType: "campaign",
      sourceId: "camp_demo_scheduled",
      status: "failed",
      createdAt: now - day,
    },
    {
      id: "msg_demo_6",
      userId: "usr_demo_new",
      direction: "inbound",
      type: "text",
      content: "はじめまして",
      sourceType: "webhook",
      sourceId: null,
      status: "read",
      createdAt: now - (10 * 60),
    },
    {
      id: "msg_demo_7",
      userId: "usr_demo_hot",
      direction: "outbound",
      type: "text",
      content: "アンケートありがとうございました。次の特典をご用意します。",
      sourceType: "manual",
      sourceId: surveyId,
      status: "sent",
      createdAt: now - (6 * hour),
    },
  ];
  for (const message of messages) {
    await run(
      db,
      `INSERT OR IGNORE INTO message_logs
       (id, account_id, ig_user_id, direction, message_type, content, source_type, source_id, delivery_status, ig_message_id, media_r2_key, is_test, is_deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, ?)`,
      message.id,
      accountId,
      message.userId,
      message.direction,
      message.type,
      message.content,
      message.sourceType,
      message.sourceId,
      message.status,
      message.createdAt,
    );
  }

  await run(
    db,
    `INSERT OR IGNORE INTO tracked_links
     (id, account_id, original_url, short_code, source_type, source_id, click_actions, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'template', ?, '[]', 1, ?, ?)`,
    "link_demo_offer",
    accountId,
    "https://example.com/offer/checklist",
    "demo-offer",
    "tpl_demo_quickreply",
    now,
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO link_clicks
     (id, tracked_link_id, account_id, ig_user_id, clicked_at)
     VALUES (?, ?, ?, ?, ?)`,
    "lclk_demo_1",
    "link_demo_offer",
    accountId,
    "usr_demo_hot",
    now - (12 * hour),
  );

  await run(
    db,
    `INSERT OR IGNORE INTO conversion_points
     (id, account_id, name, type, value, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'signup', 1, 1, ?, ?)`,
    "cvp_demo_consult",
    accountId,
    "無料相談予約",
    now,
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO conversion_events
     (id, account_id, conversion_point_id, ig_user_id, scenario_id, value, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    "cve_demo_1",
    accountId,
    "cvp_demo_consult",
    "usr_demo_hot",
    "scn_demo_consult",
    json({ source: "demo-seed" }),
    now - (8 * hour),
  );

  return {
    users: users.length,
    templates: templates.length,
    scenarios: scenarios.length,
    triggers: triggers.length,
    automations: automations.length,
    campaigns: campaigns.length,
    surveys: 1,
  };
}
