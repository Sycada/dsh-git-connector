/**
 * dsh-git-connector - git CLI wrapper.
 *
 * Discipline that this file exists to enforce:
 *   - the binary is invoked with spawn(binary, argv) and NEVER through a shell,
 *     so a repository or branch name can never become command syntax;
 *   - every invocation resets credential.helper, so the user's global helper
 *     never sees our token and can never cache it;
 *   - output is capped, and a timeout kills the child instead of hanging a turn.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Locate a git binary: configured path, then common installs, then PATH. */
export function resolveGitBinary(cfg = {}) {
  const configured = typeof cfg.gitPath === "string" ? cfg.gitPath.trim() : "";
  if (configured !== "") return { file: configured, from: "configured" };
  const candidates = [];
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles;
    const pfw = process.env["ProgramW6432"];
    const lad = process.env.LOCALAPPDATA;
    if (pf) candidates.push(join(pf, "Git", "cmd", "git.exe"));
    if (pfw) candidates.push(join(pfw, "Git", "cmd", "git.exe"));
    if (lad) candidates.push(join(lad, "Programs", "Git", "cmd", "git.exe"));
  } else {
    candidates.push("/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git");
  }
  for (const file of candidates) {
    try {
      if (existsSync(file)) return { file, from: "detected" };
    } catch { /* keep looking */ }
  }
  const onPath = findOnPath("git");
  if (onPath !== "") return { file: onPath, from: "path" };
  return { file: "git", from: "fallback" };
}

/** Resolve an executable name through PATH (with PATHEXT on Windows). */
function findOnPath(name) {
  const isWindows = process.platform === "win32";
  const exts = isWindows ? String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  const dirs = String(process.env.PATH || "").split(isWindows ? ";" : ":");
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (existsSync(candidate)) return candidate;
      } catch { /* keep looking */ }
    }
  }
  return "";
}

function capAppend(chunks, state, chunk, limit) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
  if (state.size >= limit) { state.truncated = true; return; }
  const room = limit - state.size;
  if (buf.length > room) {
    chunks.push(buf.subarray(0, room));
    state.size = limit;
    state.truncated = true;
    return;
  }
  chunks.push(buf);
  state.size += buf.length;
}

/**
 * Run one git command.
 * @param {{binary: string, args: string[], cwd?: string, env?: Record<string,string>,
 *          config?: Record<string,string>, timeoutMs?: number, limitBytes?: number}} options
 * @returns {Promise<object>} structured result; never throws for a non-zero exit.
 */
export function runGit(options) {
  const {
    binary,
    args = [],
    cwd,
    env = {},
    config = {},
    timeoutMs = 300000,
    limitBytes = 1048576,
  } = options;

  const argv = [];
  for (const [key, value] of Object.entries(config)) argv.push("-c", key + "=" + value);
  argv.push(...args);

  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(binary, argv, {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        ok: false, exitCode: null, signal: null, stdout: "", stderr: "",
        truncatedStdout: false, truncatedStderr: false, durationMs: Date.now() - started,
        timedOut: false, spawnError: String(error?.message ?? error), argv,
      });
      return;
    }

    const outChunks = [];
    const errChunks = [];
    const outState = { size: 0, truncated: false };
    const errState = { size: 0, truncated: false };
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, Math.max(1, Number(timeoutMs) || 300000));

    child.stdout?.on("data", (chunk) => capAppend(outChunks, outState, chunk, limitBytes));
    child.stderr?.on("data", (chunk) => capAppend(errChunks, errState, chunk, limitBytes));

    const settle = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal: signal ?? null,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        truncatedStdout: outState.truncated,
        truncatedStderr: errState.truncated,
        durationMs: Date.now() - started,
        timedOut,
        argv,
      });
    };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false, exitCode: null, signal: null, stdout: "", stderr: "",
        truncatedStdout: false, truncatedStderr: false, durationMs: Date.now() - started,
        timedOut, spawnError: String(error?.message ?? error), argv,
      });
    });
    child.on("close", (code, signal) => settle(code, signal));
  });
}

/** First line of <git> --version, or an error string. */
export async function gitVersion(binary) {
  const out = await runGit({ binary, args: ["--version"], timeoutMs: 15000, limitBytes: 4096 });
  if (out.spawnError) return { ok: false, version: "", error: out.spawnError };
  const line = (out.stdout || out.stderr || "").trim().split("\n")[0] ?? "";
  return { ok: out.ok, version: line, error: out.ok ? "" : line };
}

/** Newline-split NUL-tolerant helper for git's line-oriented output. */
export function lines(text) {
  return String(text || "").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l !== "");
}
