import { spawnSync } from "node:child_process";

export class WranglerError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "WranglerError";
  }
}

/** Execute wrangler command with array args (shell injection safe) */
export function wrangler(args: string[], cwd: string): string {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new WranglerError(
      `wrangler ${args.join(" ")} failed (exit ${result.status})`,
      result.stderr ?? "",
    );
  }
  return (result.stdout ?? "").trim();
}

/** Execute wrangler command with stdin input (for secret put) */
export function wranglerWithStdin(args: string[], input: string, cwd: string): string {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd,
    encoding: "utf-8",
    input,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new WranglerError(
      `wrangler ${args.join(" ")} failed (exit ${result.status})`,
      result.stderr ?? "",
    );
  }
  return (result.stdout ?? "").trim();
}

/** Execute wrangler with inherited stdio (for interactive commands like login) */
export function wranglerInteractive(args: string[], cwd: string): void {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd,
    stdio: "inherit",
    env: { ...process.env },
    timeout: 300_000,
  });
  if (result.status !== 0) {
    throw new WranglerError(`wrangler ${args.join(" ")} failed with exit code ${result.status}`, "");
  }
}

/** Check if wrangler is authenticated */
export function isWranglerAuthenticated(cwd: string): boolean {
  try {
    const output = wrangler(["whoami"], cwd);
    return !output.includes("not authenticated") && !output.includes("error");
  } catch {
    return false;
  }
}

/** Extract resource ID from wrangler output */
export function extractId(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1];
}
