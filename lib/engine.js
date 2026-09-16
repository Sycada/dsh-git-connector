/**
 * dsh-git-connector - orchestration.
 *
 * Resolves a repo profile by NAME, decides every safety gate through
 * lib/flags.js, then either runs git with an ephemeral askpass or speaks to the
 * forge API with the token resolved once per operation.
 *
 * The guards live here rather than in the tool descriptions: a refusal that
 * depends on a flag must happen BEFORE anything touches the network or the disk.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { createAskpass } from "./askpass.js";
import { resolveGitBinary, runGit, lines } from "./git.js";
import { resolveFlags } from "./flags.js";
import { getForge } from "./forge/index.js";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const REF_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Resolve a credential ref through the DSH credentials center, then env. */
export async function resolveRef(ctx, ref) {
  if (!ref) return "";
  const credentials = ctx && typeof ctx.get === "function" ? ctx.get("credentials") : undefined;
  if (credentials && typeof credentials.resolve === "function") {
    try {
      const resolved = await credentials.resolve(ref);
      if (resolved && typeof resolved.value === "string" && resolved.value !== "") return resolved.value;
    } catch { /* fall through to the environment */ }
  }
  const fromEnv = process.env[ref];
  return typeof fromEnv === "string" ? fromEnv : "";
}

function credentialsServiceOf(ctx) {
  return ctx && typeof ctx.get === "function" ? ctx.get("credentials") : undefined;
}

/** Store a credential value (empty deletes it, matching the seam's rule). */
export async function setRef(ctx, ref, value) {
  if (!REF_NAME_RE.test(String(ref))) {
    throw new Error("credential reference " + JSON.stringify(ref) + " is invalid - use only letters, digits and underscores, starting with a letter or underscore");
  }
  const credentials = credentialsServiceOf(ctx);
  if (!credentials || typeof credentials.set !== "function") {
    throw new Error("DSH credentials service is unavailable; set the environment variable " + ref + " directly instead");
  }
  if (typeof value === "string" && value.length > 0) await credentials.set(ref, value);
  else if (typeof credentials.unset === "function") await credentials.unset(ref);
}

/** Remove a credential reference. */
export async function unsetRef(ctx, ref) {
  if (!REF_NAME_RE.test(String(ref))) {
    throw new Error("credential reference " + JSON.stringify(ref) + " is invalid");
  }
  const credentials = credentialsServiceOf(ctx);
  if (!credentials) throw new Error("DSH credentials service is unavailable; remove the line from ~/.dsh/.credentials.yaml manually");
  if (typeof credentials.unset === "function") { await credentials.unset(ref); return { cleared: true, ref }; }
  throw new Error("DSH credentials service has no unset() in this build");
}

/** Describe a ref (configured / source / writable) WITHOUT revealing its value. */
export async function describeRef(ctx, ref) {
  if (!ref) return { configured: false, source: "", writable: false };
  const credentials = credentialsServiceOf(ctx);
  if (credentials && typeof credentials.describe === "function") {
    try {
      const info = await credentials.describe(ref);
      if (info && typeof info === "object") {
        return { configured: info.configured === true, source: String(info.source ?? ""), writable: info.writable === true };
      }
    } catch { /* fall through to a value probe */ }
  }
  // No describe() available: probe, and label the origin the way the real
  // provider does ("env" for an environment variable, "file" otherwise).
  const value = await resolveRef(ctx, ref);
  if (value === "") return { configured: false, source: "", writable: false };
  const fromEnv = typeof process.env[ref] === "string" && process.env[ref] !== "";
  return { configured: true, source: fromEnv ? "env" : "file", writable: !fromEnv };
}

/** The ref a provider resolves its secret from. */
export function secretRefOf(provider) {
  if (!provider) return "";
  if (provider.authType === "basic") return provider.passwordRef || "";
  if (provider.authType === "ssh") return "";
  return provider.tokenRef || "";
}

/** Resolve the provider's secret for one operation. */
export async function resolveToken(ctx, provider) {
  if (!provider || provider.authType === "none" || provider.authType === "ssh") return "";
  return resolveRef(ctx, secretRefOf(provider));
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Resolve a repo profile by id, name, or <provider>/<owner>/<repo>. */
export function requireRepo(store, ref) {
  const repo = store.findRepo(ref);
  if (repo) return repo;
  const names = store.repoNames();
  throw new Error(
    "repo profile " + JSON.stringify(ref) + " not found - " +
    (names.length > 0
      ? "saved profiles: " + names.join(", ")
      : "none saved yet (create one with git_repo_add, or in Settings > Git Connector)")
  );
}

/** Everything an operation needs about one repo, with flags already resolved. */
export function repoContext(store, cfg, repo) {
  const provider = store.providerOf(repo);
  const providerRecord = provider ? store.findProvider(provider.name) ?? null : null;
  const { effective, sources } = resolveFlags(repo, providerRecord ?? {}, cfg);
  return { repo, provider: providerRecord, flags: effective, flagSources: sources };
}

/** TLS descriptor for one repo (API + git both use it). */
export function tlsOf(flags) {
  return { insecure: flags.insecureTls === true, caFile: flags.caFile || "" };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Reject any write operation on a read-only profile. */
export function assertWritable(flags, action) {
  if (flags.readOnly === true) {
    throw new Error("repo is marked readOnly - " + action + " is refused (clear the repo's readOnly flag to permit it)");
  }
}

/** The four-way AND that governs rewriting remote history. */
export function assertForceAllowed(flags, branch, defaultBranch, confirmForce) {
  if (confirmForce !== true) throw new Error("force push requires confirmForce: true");
  if (flags.allowForcePush !== true) throw new Error("force push is disabled for this repo (set the repo flag allowForcePush, or the global allowForcePush)");
  if (flags.overwriteRemote !== true) throw new Error("force push rewrites remote history - enable the repo flag overwriteRemote to permit it for this repo");
  if (branch && branch === defaultBranch && flags.allowForceDefaultBranch !== true) {
    throw new Error("refusing to force push the default branch " + JSON.stringify(branch) + " - enable allowForceDefaultBranch for this repo if you really mean it");
  }
}

/** Gate a destructive LOCAL operation behind overwriteLocal. */
export function assertOverwriteLocal(flags, what) {
  if (flags.overwriteLocal !== true) {
    throw new Error(what + " would destroy local state - enable the repo flag overwriteLocal to permit it");
  }
}

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

/** Normalise a git failure into a friendly message. */
export function friendlyGitError(out, what) {
  if (out.spawnError) return what + ": cannot run git (" + out.spawnError + ")";
  if (out.timedOut) return what + ": timed out";
  const text = (out.stderr || out.stdout || "").trim();
  const first = text.split("\n").filter((l) => l.trim() !== "").slice(-1)[0] ?? "";
  const lower = text.toLowerCase();
  if (lower.includes("authentication failed") || lower.includes("could not read username") || lower.includes("terminal prompts disabled") || lower.includes("401")) {
    return what + ": authentication failed - check the provider's token (git_credential_status) and that the account can reach this repo";
  }
  if (lower.includes("not found") && lower.includes("repository")) return what + ": repository not found (wrong owner/repo, or the account lacks access)";
  if (lower.includes("ssl") || lower.includes("certificate")) return what + ": TLS failure - if the server uses a private CA set the repo's caFile, or the insecureTls flag to skip verification";
  if (lower.includes("not a git repository")) return what + ": the local path is not a git work copy (clone it first)";
  if (lower.includes("would be overwritten") || lower.includes("local changes")) return what + ": local changes would be overwritten - commit them, or enable the repo flag overwriteLocal";
  if (lower.includes("failed to push some refs") || lower.includes("non-fast-forward")) return what + ": push rejected (remote has commits you do not have) - fetch and merge, or force push if you really mean it";
  return what + ": " + (first || "git exited with code " + out.exitCode);
}

/** Whether a directory exists and holds anything. */
export function isNonEmptyDir(path) {
  try {
    if (!existsSync(path)) return false;
    if (!statSync(path).isDirectory()) return true;
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

/**
 * The git path actually in effect, and where it came from.
 * Order: Settings card (store) -> profile config -> auto-detection.
 * The card wins because it is the explicit, most recent human intent; the
 * profile config stays the deployment default for provisioned installs.
 */
export function effectiveGitPath(store, cfg = {}) {
  const fromSettings = store && typeof store.getSettings === "function" ? String(store.getSettings().gitPath ?? "").trim() : "";
  if (fromSettings !== "") return { path: fromSettings, source: "settings" };
  const fromConfig = typeof cfg.gitPath === "string" ? cfg.gitPath.trim() : "";
  if (fromConfig !== "") return { path: fromConfig, source: "config" };
  return { path: "", source: "auto" };
}

/** Resolve the git binary for this store + config, reporting its origin. */
export function gitBinaryFor(store, cfg = {}) {
  const { path: configured, source } = effectiveGitPath(store, cfg);
  const resolved = resolveGitBinary({ ...cfg, gitPath: configured });
  return { file: resolved.file, from: resolved.from, source };
}

/**
 * Run one git command against a repo profile.
 * Handles binary resolution, TLS config, askpass injection and cleanup.
 */
export async function runRepoGit(ctx, store, cfg, repo, args, options = {}) {
  const { provider, flags } = repoContext(store, cfg, repo);
  const binary = gitBinaryFor(store, cfg).file;
  const tls = tlsOf(flags);

  const config = { "credential.helper": "", ...(options.config ?? {}) };
  if (tls.insecure) config["http.sslVerify"] = "false";
  else if (tls.caFile) config["http.sslCAInfo"] = tls.caFile;

  let env = { ...(options.env ?? {}) };
  let cleanup = () => {};
  let hasToken = false;
  if (provider) {
    const token = await resolveToken(ctx, provider);
    hasToken = token !== "";
    if (hasToken) {
      // The username matters: git asks for it separately when the URL carries no
      // userinfo. A token-typed provider with no username still works, because
      // both Gitea and GitHub accept the token in the username slot.
      const ask = createAskpass({ secret: token, username: provider.username || token });
      env = { ...env, ...ask.env };
      cleanup = ask.cleanup;
    }
  }

  try {
    const out = await runGit({
      binary,
      args,
      cwd: options.cwd ?? repo.localPath,
      env,
      config,
      timeoutMs: options.timeoutMs ?? cfg.gitTimeoutMs ?? 300000,
      limitBytes: cfg.gitOutputLimit ?? 1048576,
    });
    return { ...out, hasToken, tlsInsecure: tls.insecure, binary };
  } finally {
    cleanup();
  }
}

/** Confirm the local path is a work copy of the expected remote. */
export async function localRepoState(ctx, store, cfg, repo) {
  const present = existsSync(repo.localPath);
  if (!present) return { present: false, isRepo: false, head: "", remoteMatches: null };
  const inside = await runRepoGit(ctx, store, cfg, repo, ["rev-parse", "--is-inside-work-tree"], { timeoutMs: 20000 });
  const isRepo = inside.ok && (inside.stdout || "").trim() === "true";
  if (!isRepo) return { present: true, isRepo: false, head: "", remoteMatches: null };
  const head = await runRepoGit(ctx, store, cfg, repo, ["rev-parse", "--short", "HEAD"], { timeoutMs: 20000 });
  const remote = await runRepoGit(ctx, store, cfg, repo, ["remote", "get-url", "origin"], { timeoutMs: 20000 });
  const remoteUrl = (remote.stdout || "").trim();
  return {
    present: true,
    isRepo: true,
    head: (head.stdout || "").trim(),
    remoteMatches: remoteUrl === "" ? null : remoteUrl === repo.remoteUrl,
    remoteUrl,
  };
}

// ---------------------------------------------------------------------------
// git operations
// ---------------------------------------------------------------------------

/** Clone the profile's remote into its localPath. */
export async function gitClone(ctx, store, cfg, repo, options = {}) {
  const { flags } = repoContext(store, cfg, repo);
  assertWritable(flags, "clone");
  let backupPath = "";
  if (existsSync(repo.localPath) && isNonEmptyDir(repo.localPath)) {
    assertOverwriteLocal(flags, "cloning into " + repo.localPath + " (already present and not empty)");
    backupPath = repo.localPath + ".dsh-bak-" + Date.now();
    renameSync(repo.localPath, backupPath);
  }
  mkdirSync(repo.localPath, { recursive: true });

  const args = ["clone", "--no-progress"];
  if (options.branch) args.push("--branch", String(options.branch));
  if (options.depth) args.push("--depth", String(Number(options.depth)));
  args.push(repo.remoteUrl, repo.localPath);

  const out = await runRepoGit(ctx, store, cfg, repo, args, {
    cwd: undefined,
    timeoutMs: options.timeoutMs ?? cfg.gitTimeoutMs,
  });
  return {
    ok: out.ok,
    backupPath,
    command: out.argv,
    exitCode: out.exitCode,
    stdout: out.stdout,
    stderr: out.ok ? out.stderr : friendlyGitError(out, "clone"),
    durationMs: out.durationMs,
    tlsInsecure: out.tlsInsecure,
    usedToken: out.hasToken,
  };
}

/** Fetch from origin. */
export async function gitFetch(ctx, store, cfg, repo, options = {}) {
  const { flags } = repoContext(store, cfg, repo);
  const args = ["fetch", "--no-progress"];
  if (options.prune !== undefined ? options.prune : flags.fetchPrune) args.push("--prune");
  if (options.force === true) { assertOverwriteLocal(flags, "a forced fetch"); args.push("--force"); }
  if (options.all === true) args.push("--all");
  else if (options.remote) args.push(String(options.remote));
  const out = await runRepoGit(ctx, store, cfg, repo, args, { timeoutMs: options.timeoutMs });
  return { ok: out.ok, exitCode: out.exitCode, stdout: out.stdout, stderr: out.ok ? out.stderr : friendlyGitError(out, "fetch"), durationMs: out.durationMs, tlsInsecure: out.tlsInsecure };
}

/** Pull into the current branch; refuses to discard local work without the flag. */
export async function gitPull(ctx, store, cfg, repo, options = {}) {
  const { flags } = repoContext(store, cfg, repo);
  assertWritable(flags, "pull");

  const dirty = await runRepoGit(ctx, store, cfg, repo, ["status", "--porcelain"], { timeoutMs: 30000 });
  const dirtyFiles = lines(dirty.stdout);
  let stashMessage = "";
  if (dirtyFiles.length > 0) {
    assertOverwriteLocal(flags, "pulling with " + dirtyFiles.length + " uncommitted change(s)");
    // Park the changes on the stash before touching the work tree, so nothing is lost.
    stashMessage = "dsh-git-connector backup " + new Date().toISOString();
    const stash = await runRepoGit(ctx, store, cfg, repo, ["stash", "push", "-u", "-m", stashMessage], { timeoutMs: 60000 });
    if (!stash.ok) {
      return { ok: false, stashed: false, error: friendlyGitError(stash, "stash before pull"), stdout: stash.stdout, stderr: stash.stderr };
    }
  }

  const args = ["pull", "--no-progress", options.rebase === true ? "--rebase" : "--ff-only"];
  if (options.remote) args.push(String(options.remote));
  if (options.branch) args.push(String(options.branch));
  const out = await runRepoGit(ctx, store, cfg, repo, args, { timeoutMs: options.timeoutMs });
  return {
    ok: out.ok,
    exitCode: out.exitCode,
    stdout: out.stdout,
    stderr: out.ok ? out.stderr : friendlyGitError(out, "pull"),
    durationMs: out.durationMs,
    stashed: stashMessage !== "",
    stashRef: stashMessage ? "stash@{0}" : "",
    stashMessage,
    restoreHint: stashMessage ? "restore with: git stash pop" : "",
    tlsInsecure: out.tlsInsecure,
  };
}

/** Push the current branch, with the force gate fully enforced. */
export async function gitPush(ctx, store, cfg, repo, options = {}) {
  const { flags } = repoContext(store, cfg, repo);
  assertWritable(flags, "push");

  const branchOut = await runRepoGit(ctx, store, cfg, repo, ["rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 20000 });
  const current = (branchOut.stdout || "").trim();
  const target = String(options.branch || current || "").trim();
  if (!target || target === "HEAD") throw new Error("push needs a branch (the work copy has no checked-out branch)");

  const force = options.force === true;
  if (force) assertForceAllowed(flags, target, repo.defaultBranch, options.confirmForce);

  // Capture the pre-push SHA of the remote ref so a force push stays reversible.
  let remoteShaBefore = "";
  if (force) {
    const ls = await runRepoGit(ctx, store, cfg, repo, ["ls-remote", "origin", "refs/heads/" + target], { timeoutMs: 60000 });
    remoteShaBefore = (ls.stdout || "").trim().split(/\s+/)[0] ?? "";
  }

  const args = ["push", "--no-progress", options.setUpstream === true ? "-u" : "", force ? "--force-with-lease" : "", "origin", target].filter((a) => a !== "");
  const out = await runRepoGit(ctx, store, cfg, repo, args, { timeoutMs: options.timeoutMs });
  return {
    ok: out.ok,
    exitCode: out.exitCode,
    stdout: out.stdout,
    stderr: out.ok ? out.stderr : friendlyGitError(out, "push"),
    durationMs: out.durationMs,
    branch: target,
    forced: force,
    remoteShaBefore,
    rollbackHint: force && remoteShaBefore ? "the previous remote ref was " + remoteShaBefore + " (reset it with: git push --force origin " + remoteShaBefore + ":refs/heads/" + target + ")" : "",
    tlsInsecure: out.tlsInsecure,
  };
}

/** Structured `git status --porcelain=v2 --branch`. */
export async function gitStatus(ctx, store, cfg, repo, options = {}) {
  const out = await runRepoGit(ctx, store, cfg, repo, ["status", "--porcelain=v2", "--branch"], { timeoutMs: 30000 });
  if (!out.ok) return { ok: false, error: friendlyGitError(out, "status"), stdout: out.stdout, stderr: out.stderr };
  return { ok: true, ...parseStatusV2(out.stdout), tlsInsecure: out.tlsInsecure };
}

/** Parse porcelain v2 output into a stable structure. */
export function parseStatusV2(text) {
  const result = {
    branch: "", upstream: "", ahead: 0, behind: 0, detached: false,
    staged: [], modified: [], untracked: [], conflicted: [], renamed: [],
  };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") continue;
    if (line.startsWith("# branch.oid ")) {
      result.detached = line.slice("# branch.oid ".length).trim() === "(initial)";
      continue;
    }
    if (line.startsWith("# branch.head ")) { result.branch = line.slice("# branch.head ".length).trim(); continue; }
    if (line.startsWith("# branch.upstream ")) { result.upstream = line.slice("# branch.upstream ".length).trim(); continue; }
    if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) { result.ahead = Number(m[1]); result.behind = Number(m[2]); }
      continue;
    }
    if (line.startsWith("? ")) { result.untracked.push(line.slice(2)); continue; }
    if (line.startsWith("u ")) {
      const parts = line.split(" ");
      result.conflicted.push(parts.slice(10).join(" "));
      continue;
    }
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const path = line.startsWith("2 ") ? parts.slice(9).join(" ").split("\t")[0] : parts.slice(8).join(" ");
      if (xy[0] !== ".") result.staged.push(path);
      if (xy[1] !== ".") result.modified.push(path);
      if (line.startsWith("2 ")) result.renamed.push(path);
      continue;
    }
  }
  result.clean = result.staged.length === 0 && result.modified.length === 0 && result.untracked.length === 0 && result.conflicted.length === 0;
  return result;
}

/** Branch list / create / checkout / delete. */
export async function gitBranch(ctx, store, cfg, repo, options = {}) {
  const { flags } = repoContext(store, cfg, repo);
  const action = String(options.action || "list").toLowerCase();
  if (action === "list") {
    // %(HEAD) is the field that actually yields "*" for the checked-out branch;
    // %(refname:short) never carries it.
    const out = await runRepoGit(ctx, store, cfg, repo, ["branch", "--format=%(HEAD)%09%(refname:short)%09%(objectname:short)%09%(upstream:short)"], { timeoutMs: 30000 });
    if (!out.ok) return { ok: false, action, error: friendlyGitError(out, "branch list") };
    const branches = lines(out.stdout).map((line) => {
      const [head = "", name = "", sha = "", upstream = ""] = line.split("\t");
      return { name, sha, upstream, current: head.trim() === "*" };
    });
    return { ok: true, action, branches };
  }
  assertWritable(flags, "branch " + action);
  const name = String(options.name || "").trim();
  if (!name) throw new Error("branch " + action + " needs a name");
  if (action === "create") {
    const out = await runRepoGit(ctx, store, cfg, repo, ["branch", name, ...(options.startPoint ? [String(options.startPoint)] : [])], { timeoutMs: 30000 });
    return { ok: out.ok, action, name, error: out.ok ? "" : friendlyGitError(out, "branch create") };
  }
  if (action === "checkout") {
    const args = ["checkout"];
    if (options.create === true) args.push("-b");
    args.push(name);
    const out = await runRepoGit(ctx, store, cfg, repo, args, { timeoutMs: 60000 });
    return { ok: out.ok, action, name, error: out.ok ? "" : friendlyGitError(out, "branch checkout") };
  }
  if (action === "delete") {
    const sha = await runRepoGit(ctx, store, cfg, repo, ["rev-parse", name], { timeoutMs: 20000 });
    const deletedSha = (sha.stdout || "").trim();
    let force = false;
    const first = await runRepoGit(ctx, store, cfg, repo, ["branch", "-d", name], { timeoutMs: 30000 });
    if (!first.ok) {
      // Unmerged branch: only the overwriteLocal flag can authorise losing it.
      assertOverwriteLocal(flags, "deleting the unmerged branch " + JSON.stringify(name));
      const forced = await runRepoGit(ctx, store, cfg, repo, ["branch", "-D", name], { timeoutMs: 30000 });
      force = forced.ok;
      return { ok: forced.ok, action, name, forced, deletedSha, error: forced.ok ? "" : friendlyGitError(forced, "branch delete") };
    }
    return { ok: true, action, name, forced: force, deletedSha, error: "" };
  }
  throw new Error("branch action must be list|create|checkout|delete, got " + JSON.stringify(action));
}

/** Diff (working tree or staged). */
export async function gitDiff(ctx, store, cfg, repo, options = {}) {
  const args = ["diff", "--no-color"];
  if (options.staged === true) args.push("--staged");
  if (options.stat === true) args.push("--stat");
  if (options.path) args.push("--", String(options.path));
  const out = await runRepoGit(ctx, store, cfg, repo, args, { timeoutMs: 60000 });
  const maxLines = Number(options.maxLines ?? cfg.maxOutputLines ?? 2000);
  const all = lines(out.stdout);
  const shown = all.slice(0, maxLines);
  return {
    ok: out.ok,
    files: shown.filter((l) => l.startsWith("diff --git")).map((l) => l.replace("diff --git a/", "").split(" b/")[0]),
    diff: shown.join("\n"),
    totalLines: all.length,
    truncated: all.length > shown.length,
  };
}

/** Structured log. */
export async function gitLog(ctx, store, cfg, repo, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit ?? 20), 200));
  const args = ["log", "-n", String(limit), "--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e"];
  if (options.path) args.push("--", String(options.path));
  if (options.branch) args.push(String(options.branch));
  const out = await runRepoGit(ctx, store, cfg, repo, args, { timeoutMs: 60000 });
  if (!out.ok) return { ok: false, error: friendlyGitError(out, "log"), commits: [] };
  const commits = lines(out.stdout.split("\x1e").join("\n"))
    .map((record) => {
      const parts = record.split("\x1f");
      if (parts.length < 5) return null;
      return { sha: parts[0], author: parts[1], email: parts[2], date: parts[3], subject: parts.slice(4).join(" ") };
    })
    .filter(Boolean);
  return { ok: true, commits };
}

/** Stage and commit, always under this plugin's own identity. */
export async function gitCommit(ctx, store, cfg, repo, options = {}) {
  const { flags } = repoContext(store, cfg, repo);
  assertWritable(flags, "commit");
  const message = String(options.message || "").trim();
  if (!message) throw new Error("commit needs a message");

  const paths = Array.isArray(options.paths) ? options.paths.map(String) : [];
  const addArgs = paths.length > 0 ? ["add", "--", ...paths] : ["add", "-A"];
  const add = await runRepoGit(ctx, store, cfg, repo, addArgs, { timeoutMs: 60000 });
  if (!add.ok) return { ok: false, stage: "add", error: friendlyGitError(add, "add"), stdout: add.stdout, stderr: add.stderr };

  const identity = commitIdentityOf(flags);
  const commit = await runRepoGit(ctx, store, cfg, repo, ["commit", "-m", message], {
    timeoutMs: 60000,
    config: {
      "user.name": identity.name,
      "user.email": identity.email,
    },
  });
  if (!commit.ok) {
    const text = (commit.stdout + commit.stderr).toLowerCase();
    if (text.includes("nothing to commit")) return { ok: true, committed: false, identity, note: "nothing to commit (the work copy is clean)" };
    return { ok: false, stage: "commit", error: friendlyGitError(commit, "commit"), identity, stdout: commit.stdout, stderr: commit.stderr };
  }
  const sha = await runRepoGit(ctx, store, cfg, repo, ["rev-parse", "HEAD"], { timeoutMs: 20000 });
  return { ok: true, committed: true, identity, sha: (sha.stdout || "").trim() };
}

/** The commit identity this plugin signs with. */
export function commitIdentityOf(flags) {
  const label = String(flags.commitIdentity || "").trim();
  const name = label ? "dsh-git-connector[" + label + "]" : "dsh-git-connector";
  return { name, email: "dsh-git-connector@localhost" };
}

// ---------------------------------------------------------------------------
// forge operations
// ---------------------------------------------------------------------------

/** Build the adapter context for one repo (or one provider). */
export async function forgeContext(ctx, store, cfg, repo, providerOverride = null) {
  const provider = providerOverride ?? store.providerOf(repo);
  if (!provider) throw new Error("this repo profile has no provider - forge API calls need one");
  const flags = repo ? repoContext(store, cfg, repo).flags : resolveFlags({}, provider, cfg);
  const token = await resolveToken(ctx, provider);
  const forge = await getForge(provider);
  return {
    forge,
    provider,
    token,
    tls: tlsOf(flags),
    timeoutMs: cfg.httpTimeoutMs ?? 30000,
    flags,
  };
}

/** Delete a provider, optionally clearing its stored secret (shared refs are skipped). */
export async function removeProviderWithCreds(ctx, store, idOrName, clear = false) {
  const provider = store.findProvider(idOrName);
  if (!provider) throw new Error("provider " + JSON.stringify(idOrName) + " not found");
  const ref = secretRefOf(provider);
  const others = store.rawProviders().filter((p) => p.id !== provider.id);
  const cleared = [];
  const skipped = [];
  if (clear && ref) {
    if (others.some((p) => secretRefOf(p) === ref)) {
      skipped.push({ ref, reason: "shared-with-other-providers" });
    } else {
      try {
        const result = await unsetRef(ctx, ref);
        cleared.push(result.ref);
      } catch (error) {
        skipped.push({ ref, reason: String(error?.message ?? error) });
      }
    }
  }
  const removed = store.removeProvider(provider.id);
  return {
    removed: { id: removed.id, name: removed.name, kind: removed.kind },
    clearRequested: clear === true,
    ref,
    cleared,
    skipped,
  };
}

