/**
 * dsh-git-connector - ephemeral GIT_ASKPASS helper.
 *
 * Git asks for credentials by EXECUTING a program named by GIT_ASKPASS. That
 * program must print the secret on stdout. Three rules drive this design:
 *
 *   1. the secret travels through the ENVIRONMENT of the git child process,
 *      never through argv (visible in process listings) and never written to disk;
 *   2. the generated helper directory holds no secret and is deleted as soon as
 *      the git command finishes;
 *   3. orphaned helper directories from a crashed run are swept on sight.
 *
 * The helper is a tiny JS file invoked through a launcher (.cmd on Windows,
 * .sh elsewhere) because git can only execute a real program there. The launcher
 * sets ELECTRON_RUN_AS_NODE so the same code works when DSH runs inside Electron.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storePaths } from "./paths.js";

/** Helper body. Receives the prompt as argv[2]; prints username or secret. */
const HELPER_SOURCE = [
  "// dsh-git-connector askpass helper - prints the credential git asked for.",
  "// The value arrives through the environment, never through argv, never on disk.",
  "const prompt = process.argv.slice(2).join(' ');",
  "const wantsUsername = /username/i.test(prompt);",
  "const value = wantsUsername",
  "  ? (process.env.DSH_GIT_ASKPASS_USERNAME || '')",
  "  : (process.env.DSH_GIT_ASKPASS_SECRET || '');",
  "process.stdout.write(value + '\\n');",
  "",
].join("\n");

/** Directory holding transient askpass helpers. */
export function askpassRoot() {
  return join(storePaths().dir, "tmp");
}

const ORPHAN_MAX_AGE_MS = 60 * 60 * 1000;

/** Remove helper directories left behind by a crashed or killed run. */
export function sweepAskpass(now = Date.now()) {
  const root = askpassRoot();
  let entries;
  try { entries = readdirSync(root); } catch { return 0; }
  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith("ask-")) continue;
    const full = join(root, name);
    try {
      const st = statSync(full);
      // The owning pid is embedded in the name; a dead pid plus an old mtime is
      // safe to reap. We only check age, because pid reuse makes liveness unsafe.
      if (now - st.mtimeMs < ORPHAN_MAX_AGE_MS) continue;
      rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch { /* ignore an entry we cannot stat or remove */ }
  }
  return removed;
}

/**
 * Materialise one askpass helper.
 * @param {{secret?: string, username?: string}} spec
 * @returns {{dir: string, launcher: string, env: Record<string,string>, cleanup: () => void}}
 */
export function createAskpass(spec = {}) {
  const secret = typeof spec.secret === "string" ? spec.secret : "";
  const username = typeof spec.username === "string" ? spec.username : "";
  sweepAskpass();

  const root = askpassRoot();
  mkdirSync(root, { recursive: true });
  const dir = join(root, "ask-" + process.pid + "-" + randomBytes(6).toString("hex"));
  mkdirSync(dir, { recursive: true });

  const helper = join(dir, "askpass.js");
  writeFileSync(helper, HELPER_SOURCE, "utf8");

  const isWindows = process.platform === "win32";
  const launcher = join(dir, isWindows ? "askpass.cmd" : "askpass.sh");
  if (isWindows) {
    const lines = [
      "@echo off",
      "set ELECTRON_RUN_AS_NODE=1",
      '"' + process.execPath + '" "' + helper + '" %*',
      "",
    ];
    writeFileSync(launcher, lines.join("\r\n"), "utf8");
  } else {
    const lines = [
      "#!/bin/sh",
      "ELECTRON_RUN_AS_NODE=1",
      "export ELECTRON_RUN_AS_NODE",
      'exec "' + process.execPath + '" "' + helper + '" "$@"',
      "",
    ];
    writeFileSync(launcher, lines.join("\n"), "utf8");
    try { chmodSync(launcher, 0o700); } catch { /* best effort */ }
  }

  const env = {
    GIT_ASKPASS: launcher,
    GIT_TERMINAL_PROMPT: "0",
    DSH_GIT_ASKPASS_SECRET: secret,
    DSH_GIT_ASKPASS_USERNAME: username,
  };

  return {
    dir,
    launcher,
    helper,
    env,
    cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}
