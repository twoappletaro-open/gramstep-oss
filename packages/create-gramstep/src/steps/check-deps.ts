import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

/** Check required dependencies: Node.js 20+ and npx */
export async function checkDeps(): Promise<void> {
  p.log.step(pc.bold("環境チェック"));

  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  if (major < 20) {
    throw new SetupError(`Node.js 20以上が必要です（現在: ${nodeVersion}）`);
  }
  p.log.success(`Node.js ${nodeVersion}`);

  try {
    execSync("npx --version", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    throw new SetupError("npx が見つかりません。Node.js を再インストールしてください。");
  }
  p.log.success("npx available");
}
