import type { Result, AppError, CreateAbTestInput, AbTestEventType } from "@gramstep/shared";
import type { AbTest, AbTestVariant } from "@gramstep/db";
import { ok, err, createAppError } from "@gramstep/shared";
import { generateId } from "@gramstep/db";

export interface AbTestWithVariants {
  test: AbTest;
  variants: AbTestVariant[];
}

export interface VariantMetrics {
  variantId: string;
  name: string;
  sentCount: number;
  clickCount: number;
  cvCount: number;
  clickRate: number;
  cvRate: number;
}

export interface AbTestEngineService {
  createAbTest(accountId: string, input: CreateAbTestInput): Promise<Result<AbTestWithVariants, AppError>>;
  selectVariant(abTestId: string): Promise<Result<AbTestVariant, AppError>>;
  recordSent(variantId: string): Promise<Result<void, AppError>>;
  recordEvent(variantId: string, igUserId: string, eventType: AbTestEventType): Promise<Result<void, AppError>>;
  getTestMetrics(abTestId: string, accountId: string): Promise<Result<VariantMetrics[], AppError>>;
  deleteAbTest(id: string, accountId: string): Promise<Result<void, AppError>>;
}

export interface AbTestEngineDeps {
  db: D1Database;
}

const MAX_VARIANTS = 3;
const MIN_VARIANTS = 2;

export function createAbTestEngine(deps: AbTestEngineDeps): AbTestEngineService {
  const { db } = deps;

  function wrapD1<T>(fn: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return fn().catch((e: unknown) =>
      err(createAppError("D1_ERROR", e instanceof Error ? e.message : "Database error")),
    );
  }

  function weightedRandom(variants: AbTestVariant[]): AbTestVariant {
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    let random = Math.random() * totalWeight;
    for (const variant of variants) {
      random -= variant.weight;
      if (random <= 0) return variant;
    }
    const last = variants[variants.length - 1];
    if (!last) {
      return variants[0]!; // variants は非空が前提（呼出元で保証）
    }
    return last;
  }

  return {
    createAbTest: (accountId, input) =>
      wrapD1(async () => {
        if (input.variants.length < MIN_VARIANTS) {
          return err(createAppError("VALIDATION_ERROR", `A/Bテストには最低${MIN_VARIANTS}つのバリアントが必要です`));
        }
        if (input.variants.length > MAX_VARIANTS) {
          return err(createAppError("VALIDATION_ERROR", `A/Bテストのバリアントは最大${MAX_VARIANTS}つまでです`));
        }

        // Verify template belongs to account
        const tpl = await db
          .prepare(`SELECT id FROM templates WHERE id = ? AND account_id = ?`)
          .bind(input.template_id, accountId)
          .first<{ id: string }>();
        if (!tpl) {
          return err(createAppError("NOT_FOUND", "Template not found"));
        }

        const testId = generateId();
        const now = Math.floor(Date.now() / 1000);

        await db
          .prepare(
            `INSERT INTO ab_tests (id, account_id, template_id, name, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(testId, accountId, input.template_id, input.name, now, now)
          .run();

        const createdVariants: AbTestVariant[] = [];

        for (const v of input.variants) {
          const variantId = generateId();
          await db
            .prepare(
              `INSERT INTO ab_test_variants (id, ab_test_id, name, body, weight, sent_count, click_count, cv_count, created_at)
               VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)`,
            )
            .bind(variantId, testId, v.name, v.body, v.weight, now)
            .run();

          createdVariants.push({
            id: variantId,
            ab_test_id: testId,
            name: v.name,
            body: v.body,
            weight: v.weight,
            sent_count: 0,
            click_count: 0,
            cv_count: 0,
            created_at: now,
          });
        }

        const test: AbTest = {
          id: testId,
          account_id: accountId,
          template_id: input.template_id,
          name: input.name,
          is_active: 1,
          created_at: now,
          updated_at: now,
        };

        return ok({ test, variants: createdVariants });
      }),

    selectVariant: (abTestId) =>
      wrapD1(async () => {
        const test = await db
          .prepare(`SELECT * FROM ab_tests WHERE id = ?`)
          .bind(abTestId)
          .first<AbTest>();

        if (!test) {
          return err(createAppError("NOT_FOUND", "A/B test not found"));
        }
        if (!test.is_active) {
          return err(createAppError("VALIDATION_ERROR", "A/Bテストが非アクティブです"));
        }

        const variantsResult = await db
          .prepare(`SELECT * FROM ab_test_variants WHERE ab_test_id = ?`)
          .bind(abTestId)
          .all<AbTestVariant>();

        if (variantsResult.results.length === 0) {
          return err(createAppError("NOT_FOUND", "No variants found"));
        }

        const selected = weightedRandom(variantsResult.results);

        // NOTE: sent_count is NOT incremented here. Call recordSent() after delivery success.
        return ok(selected);
      }),

    recordSent: (variantId) =>
      wrapD1(async () => {
        await db
          .prepare(`UPDATE ab_test_variants SET sent_count = sent_count + 1 WHERE id = ?`)
          .bind(variantId)
          .run();
        return ok(undefined);
      }),

    recordEvent: (variantId, igUserId, eventType) =>
      wrapD1(async () => {
        const eventId = generateId();
        const now = Math.floor(Date.now() / 1000);

        // For conversions: check 7-day attribution window from last click
        if (eventType === "conversion") {
          const click = await db
            .prepare(
              `SELECT created_at FROM ab_test_events
               WHERE variant_id = ? AND ig_user_id = ? AND event_type = 'click'
               ORDER BY created_at DESC LIMIT 1`,
            )
            .bind(variantId, igUserId)
            .first<{ created_at: number }>();

          if (!click || now - click.created_at > 7 * 86400) {
            return ok(undefined); // Outside attribution window
          }
        }

        // INSERT OR IGNORE for dedup (unique index on variant_id, ig_user_id, event_type)
        const result = await db
          .prepare(
            `INSERT OR IGNORE INTO ab_test_events (id, variant_id, ig_user_id, event_type, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(eventId, variantId, igUserId, eventType, now)
          .run();

        // Only increment if actually inserted (not duplicate)
        if (result.meta.changes && result.meta.changes > 0) {
          if (eventType === "click") {
            await db
              .prepare(`UPDATE ab_test_variants SET click_count = click_count + 1 WHERE id = ?`)
              .bind(variantId)
              .run();
          } else {
            await db
              .prepare(`UPDATE ab_test_variants SET cv_count = cv_count + 1 WHERE id = ?`)
              .bind(variantId)
              .run();
          }
        }

        return ok(undefined);
      }),

    getTestMetrics: (abTestId, accountId) =>
      wrapD1(async () => {
        const test = await db
          .prepare(`SELECT * FROM ab_tests WHERE id = ? AND account_id = ?`)
          .bind(abTestId, accountId)
          .first<AbTest>();

        if (!test) {
          return err(createAppError("NOT_FOUND", "A/B test not found"));
        }

        const variantsResult = await db
          .prepare(`SELECT * FROM ab_test_variants WHERE ab_test_id = ?`)
          .bind(abTestId)
          .all<AbTestVariant>();

        const metrics: VariantMetrics[] = variantsResult.results.map((v) => ({
          variantId: v.id,
          name: v.name,
          sentCount: v.sent_count,
          clickCount: v.click_count,
          cvCount: v.cv_count,
          clickRate: v.sent_count > 0 ? v.click_count / v.sent_count : 0,
          cvRate: v.click_count > 0 ? v.cv_count / v.click_count : 0,
        }));

        return ok(metrics);
      }),

    deleteAbTest: (id, accountId) =>
      wrapD1(async () => {
        const test = await db
          .prepare(`SELECT * FROM ab_tests WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .first<AbTest>();

        if (!test) {
          return err(createAppError("NOT_FOUND", "A/B test not found"));
        }

        await db
          .prepare(`DELETE FROM ab_tests WHERE id = ? AND account_id = ?`)
          .bind(id, accountId)
          .run();

        return ok(undefined);
      }),
  };
}
