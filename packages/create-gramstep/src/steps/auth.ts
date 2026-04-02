import * as p from "@clack/prompts";
import pc from "picocolors";
import { isWranglerAuthenticated, wrangler, wranglerInteractive } from "../lib/wrangler.js";
import { SetupError } from "./check-deps.js";
import type { SetupState } from "../lib/state.js";

/** Authenticate with Cloudflare and get account ID */
export async function authenticate(state: SetupState, projectDir: string): Promise<void> {
  p.log.step(pc.bold("Cloudflare 認証"));

  if (!isWranglerAuthenticated(projectDir)) {
    p.log.info("ブラウザが開きます。Cloudflareアカウントでログインしてください。");
    wranglerInteractive(["login"], projectDir);

    if (!isWranglerAuthenticated(projectDir)) {
      throw new SetupError("Cloudflare認証に失敗しました。再度お試しください。");
    }
  }
  p.log.success("Cloudflare認証済み");

  if (!state.accountId) {
    const output = wrangler(["whoami"], projectDir);
    const match = output.match(/([0-9a-f]{32})/);
    if (match?.[1]) {
      state.accountId = match[1];
    }
    if (state.accountId) {
      p.log.success(`Account ID: ${state.accountId.slice(0, 8)}...`);
    }
  }
}
