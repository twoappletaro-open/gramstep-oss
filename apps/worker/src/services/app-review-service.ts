import { executeRun, executeFirst } from "@gramstep/db";
import type { Result, AppError } from "@gramstep/shared";
import { ok, err, createAppError } from "@gramstep/shared";
import { z } from "zod";

// ────────── Types ──────────

export interface AppReviewDeps {
  db: D1Database;
}

export type HumanAgentStatus =
  | "not_requested"
  | "pending"
  | "approved"
  | "rejected";

export interface AppReviewSettings {
  privacy_policy_url: string;
  purpose_description: string;
  verification_steps: string;
  human_agent_status: HumanAgentStatus;
}

export interface UpdateAppReviewInput {
  privacy_policy_url?: string;
  purpose_description?: string;
  verification_steps?: string;
}

interface AccountRow {
  id: string;
  settings: string;
}

interface AccountSettings {
  app_review?: Partial<AppReviewSettings>;
  [key: string]: unknown;
}

export interface AppReviewService {
  getSettings(accountId: string): Promise<Result<AppReviewSettings, AppError>>;
  updateSettings(
    accountId: string,
    input: UpdateAppReviewInput,
  ): Promise<Result<AppReviewSettings, AppError>>;
  updateHumanAgentStatus(
    accountId: string,
    status: HumanAgentStatus,
  ): Promise<Result<void, AppError>>;
}

// ────────── Helpers ──────────

const DEFAULTS: AppReviewSettings = {
  privacy_policy_url: "",
  purpose_description: "",
  verification_steps: "",
  human_agent_status: "not_requested",
};

function isValidUrl(url: string): boolean {
  if (!url) return true; // empty is ok
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// ────────── Factory ──────────

export function createAppReviewService(deps: AppReviewDeps): AppReviewService {
  const { db } = deps;

  async function loadAccountSettings(
    accountId: string,
  ): Promise<Result<{ row: AccountRow; parsed: AccountSettings }, AppError>> {
    const result = await executeFirst<AccountRow>(
      db,
      "SELECT id, settings FROM accounts WHERE id = ?",
      accountId,
    );

    if (!result.ok) {
      return err(createAppError("D1_ERROR", result.error.message));
    }

    if (!result.value) {
      return err(createAppError("NOT_FOUND", `Account ${accountId} not found`));
    }

    const safeParsed = z.record(z.unknown()).safeParse(JSON.parse(result.value.settings || "{}"));
    const parsed: AccountSettings = safeParsed.success ? (safeParsed.data as AccountSettings) : {};
    return ok({ row: result.value, parsed });
  }

  return {
    async getSettings(accountId) {
      const loadResult = await loadAccountSettings(accountId);
      if (!loadResult.ok) return err(loadResult.error);

      const { parsed } = loadResult.value;
      const appReview = parsed.app_review ?? {};

      return ok({
        privacy_policy_url: appReview.privacy_policy_url ?? DEFAULTS.privacy_policy_url,
        purpose_description: appReview.purpose_description ?? DEFAULTS.purpose_description,
        verification_steps: appReview.verification_steps ?? DEFAULTS.verification_steps,
        human_agent_status: appReview.human_agent_status ?? DEFAULTS.human_agent_status,
      });
    },

    async updateSettings(accountId, input) {
      if (input.privacy_policy_url !== undefined && !isValidUrl(input.privacy_policy_url)) {
        return err(
          createAppError("VALIDATION_ERROR", "Invalid privacy policy URL. Must be http:// or https://"),
        );
      }

      const loadResult = await loadAccountSettings(accountId);
      if (!loadResult.ok) return err(loadResult.error);

      const { parsed } = loadResult.value;
      const current = parsed.app_review ?? {};

      const updated: Partial<AppReviewSettings> = {
        ...current,
        ...(input.privacy_policy_url !== undefined && {
          privacy_policy_url: input.privacy_policy_url,
        }),
        ...(input.purpose_description !== undefined && {
          purpose_description: input.purpose_description,
        }),
        ...(input.verification_steps !== undefined && {
          verification_steps: input.verification_steps,
        }),
      };

      parsed.app_review = updated;
      const now = Math.floor(Date.now() / 1000);

      const saveResult = await executeRun(
        db,
        "UPDATE accounts SET settings = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(parsed),
        now,
        accountId,
      );

      if (!saveResult.ok) {
        return err(createAppError("D1_ERROR", saveResult.error.message));
      }

      return ok({
        privacy_policy_url: updated.privacy_policy_url ?? DEFAULTS.privacy_policy_url,
        purpose_description: updated.purpose_description ?? DEFAULTS.purpose_description,
        verification_steps: updated.verification_steps ?? DEFAULTS.verification_steps,
        human_agent_status: updated.human_agent_status ?? DEFAULTS.human_agent_status,
      });
    },

    async updateHumanAgentStatus(accountId, status) {
      const loadResult = await loadAccountSettings(accountId);
      if (!loadResult.ok) return err(loadResult.error);

      const { parsed } = loadResult.value;
      const current = parsed.app_review ?? {};
      current.human_agent_status = status;
      parsed.app_review = current;

      const now = Math.floor(Date.now() / 1000);
      const saveResult = await executeRun(
        db,
        "UPDATE accounts SET settings = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(parsed),
        now,
        accountId,
      );

      if (!saveResult.ok) {
        return err(createAppError("D1_ERROR", saveResult.error.message));
      }

      return ok(undefined);
    },
  };
}
