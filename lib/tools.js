/**
 * dsh-git-connector - agent tool definitions.
 *
 * Every tool declares `output { schema, render }`. That is mandatory: the
 * registry rejects a definition without them, and it validates the returned
 * value against `schema` on every call. Schemas therefore stay inside the
 * harness' supported JSON Schema subset (type/oneOf/properties/required/
 * additionalProperties/items/enum/const + annotations) and every return value
 * uses exactly the declared keys.
 *
 * Secrets are addressed by REFERENCE only. No tool ever returns, logs or
 * accepts an inline token.
 */
import { createRequire } from "node:module";
import {
  requireRepo, repoContext, gitClone, gitFetch, gitPull, gitPush, gitStatus,
  gitBranch, gitDiff, gitLog, gitCommit, localRepoState,
  describeRef, secretRefOf, removeProviderWithCreds, forgeContext,
} from "./engine.js";
import { publicFlags, resolveFlags } from "./flags.js";

const requireMod = createRequire(import.meta.url);

const str = (v) => (typeof v === "string" ? v.trim() : "");
const content = (text) => [{ type: "text", text: text === undefined || text === null ? "" : String(text) }];
const safe = (fn) => (_args, value) => {
  try {
    const out = fn(_args, value);
    return Array.isArray(out) ? out : content(out);
  } catch {
    return content(JSON.stringify(value, null, 2));
  }
};

const OUT_OK = (extra = {}) => ({
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" }, ...extra },
});

const STR_ARRAY = { type: "array", items: { type: "string" } };
const NUMBER_OR_NULL = { oneOf: [{ type: "number" }, { type: "null" }] };
const BOOL_OR_STRING = { oneOf: [{ type: "boolean" }, { type: "string" }] };
const FREE_OBJECT = { type: "object", additionalProperties: true };

const PROVIDER_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    kind: { type: "string" },
    apiBaseUrl: { type: "string" },
    gitBaseUrl: { type: "string" },
    authType: { type: "string" },
    username: { type: "string" },
    tokenRef: { type: "string" },
    passwordRef: { type: "string" },
    keyPath: { type: "string" },
    caFile: { type: "string" },
    allowInsecure: { type: "boolean" },
    defaultBranch: { type: "string" },
    secretRef: { type: "string" },
    secretSet: { type: "boolean" },
    secretSource: { type: "string" },
    created: { type: "string" },
    updated: { type: "string" },
  },
};

const REPO_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    providerRef: { type: "string" },
    owner: { type: "string" },
    repo: { type: "string" },
    remoteUrl: { type: "string" },
    localPath: { type: "string" },
    defaultBranch: { type: "string" },
    flags: FREE_OBJECT,
    activeFlags: STR_ARRAY,
    created: { type: "string" },
    updated: { type: "string" },
  },
};

const FLAG_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    value: BOOL_OR_STRING,
    source: { type: "string" },
    overridden: { type: "boolean" },
    dangerous: { type: "boolean" },
    repoOnly: { type: "boolean" },
    description: { type: "string" },
  },
};

const LOCAL_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    present: { type: "boolean" },
    isRepo: { type: "boolean" },
    head: { type: "string" },
    remoteMatches: { oneOf: [{ type: "boolean" }, { type: "null" }] },
    remoteUrl: { type: "string" },
  },
};

const GIT_RUN_OUT = {
  exitCode: NUMBER_OR_NULL,
  stdout: { type: "string" },
  stderr: { type: "string" },
  durationMs: { type: "number" },
  tlsInsecure: { type: "boolean" },
};

const FORGE_REPO_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    fullName: { type: "string" }, name: { type: "string" }, owner: { type: "string" },
    private: { type: "boolean" }, defaultBranch: { type: "string" }, description: { type: "string" },
    cloneUrl: { type: "string" }, sshUrl: { type: "string" }, htmlUrl: { type: "string" },
    empty: { type: "boolean" }, updatedAt: { type: "string" },
  },
};

const PULL_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    number: { type: "number" }, title: { type: "string" }, state: { type: "string" },
    author: { type: "string" }, head: { type: "string" }, base: { type: "string" },
    htmlUrl: { type: "string" }, createdAt: { type: "string" }, merged: { type: "boolean" },
  },
};

const PROVIDER_PROPS = {
  name: { type: "string", description: "Unique provider name, e.g. 'my-gitea'. Referenced by repo profiles." },
  kind: { type: "string", enum: ["gitea", "forgejo", "github"], description: "Forge kind (default gitea)." },
  baseUrl: { type: "string", description: "Shorthand: sets both API and git base URLs (Gitea/Forgejo style)." },
  apiBaseUrl: { type: "string", description: "Forge API origin, e.g. https://git.example.com" },
  gitBaseUrl: { type: "string", description: "Git transport origin used to derive remote URLs." },
  authType: { type: "string", enum: ["token", "basic", "ssh", "none"], description: "How the secret is used (default token)." },
  username: { type: "string", description: "Account name used as the git username." },
  tokenRef: { type: "string", description: "Credential reference holding the token (default DSH_GIT_CONNECTOR_<NAME>_TOKEN). Never the token itself." },
  passwordRef: { type: "string", description: "Credential reference holding the password when authType=basic." },
  keyPath: { type: "string", description: "Private key path when authType=ssh." },
  caFile: { type: "string", description: "PEM file used to verify this forge's certificate." },
  allowInsecure: { type: "boolean", description: "Skip TLS verification by default for this provider (prefer caFile)." },
  defaultBranch: { type: "string", description: "Default branch name (default main)." },
};

const FORGE_TARGET_PROPS = {
  repo: { type: "string", description: "Saved repo profile name (preferred) - supplies provider, owner and repo." },
  provider: { type: "string", description: "Provider name, when no repo profile is used." },
  owner: { type: "string", description: "Owner/org, when no repo profile is used." },
  repository: { type: "string", description: "Repository name, when no repo profile is used." },
};

/**
 * Resolve forge coordinates from either a repo profile or a provider.
 *
 * Coordinates are only required by repo-scoped endpoints. Account-scoped calls
 * (listing the token's repositories, creating a repository) address the
 * authenticated user, so they pass { needCoords: false } instead of inventing
 * an owner/repo pair they do not have.
 */
function forgeTarget(store, cfg, args, options = {}) {
  const needCoords = options.needCoords !== false;
  const repoRef = str(args.repo);
  if (repoRef) {
    const profile = requireRepo(store, repoRef);
    const provider = store.providerOf(profile);
    if (!provider) throw new Error("repo profile " + JSON.stringify(repoRef) + " has no provider - forge API calls need one");
    const { flags } = repoContext(store, cfg, profile);
    return { provider, owner: str(args.owner) || profile.owner, repository: str(args.repository) || profile.repo, profile, flags };
  }
  const providerRef = str(args.provider);
  if (!providerRef) throw new Error("give either repo (a saved profile) or provider + owner + repository");
  const provider = store.findProvider(providerRef);
  if (!provider) {
    const names = store.listProviders().map((p) => p.name);
    throw new Error("provider " + JSON.stringify(providerRef) + " not found - known providers: " + (names.join(", ") || "(none saved yet)"));
  }
  const owner = str(args.owner);
  const repository = str(args.repository);
  if (needCoords && (!owner || !repository)) {
    throw new Error("this call is repo-scoped and needs both owner and repository (or pass a saved repo profile via repo)");
  }
  return { provider, owner, repository, profile: null, flags: resolveFlags({}, provider, cfg).effective };
}

/** Register every agent tool. Returns the teardown function. */
export function registerTools(ctx, api) {
  const { store, cfg } = api;
  ctx.inject(["tools"], (sctx) => {
    sctx.effect(() => {
      const { defineTool } = requireMod("@deepseek-ai/dsh-tools");
      const disposers = [];
      const add = (tool) => { disposers.push(sctx.tools.register(defineTool(tool))); };

      // ---------------------------------------------------------------- providers
      add({
        name: "git_provider_list",
        description: "List saved git forge providers (Gitea/Forgejo/GitHub) with their API/git base URLs and whether a key is stored. Never returns the key itself. Use before git_repo_add to see which provider names exist.",
        parameters: {},
        output: {
          schema: OUT_OK({ count: { type: "number" }, providers: { type: "array", items: PROVIDER_ITEM } }),
          render: safe((_a, v) => {
            if (!v.providers?.length) return "No providers saved yet. Add one with git_provider_add (name + kind + baseUrl), then store its key in Settings > Git Connector.";
            return v.providers.map((p) => p.name + " [" + p.kind + "] " + p.apiBaseUrl + " | git " + p.gitBaseUrl + " | key " + (p.secretSet ? "set (" + (p.secretSource || "file") + ")" : "NOT SET") + " | ref " + p.secretRef).join("\n");
          }),
        },
        async execute() {
          const providers = [];
          for (const p of store.listProviders()) {
            const ref = secretRefOf(p);
            const info = ref ? await describeRef(ctx, ref) : { configured: false, source: "" };
            providers.push({ ...p, secretRef: ref, secretSet: info.configured === true, secretSource: info.source || "" });
          }
          return { ok: true, count: providers.length, providers };
        },
      });

      add({
        name: "git_provider_add",
        description: "Save a git forge provider (Gitea/Forgejo/GitHub): its base URLs, account name and the credential REFERENCE holding its key. Never pass the key itself - store it in Settings > Git Connector (git_credential_status shows what is missing).",
        parameters: PROVIDER_PROPS,
        output: {
          schema: OUT_OK({ provider: PROVIDER_ITEM, hint: { type: "string" } }),
          render: safe((_a, v) => {
            const p = v.provider;
            if (!p) return "Provider saved.";
            return "Provider saved: " + p.name + " [" + p.kind + "] api=" + p.apiBaseUrl + " git=" + p.gitBaseUrl + "\n" + (v.hint || "");
          }),
        },
        async execute(args) {
          const created = store.upsertProvider({
            name: str(args.name), kind: str(args.kind) || "gitea",
            baseUrl: str(args.baseUrl), apiBaseUrl: str(args.apiBaseUrl), gitBaseUrl: str(args.gitBaseUrl),
            authType: str(args.authType) || "token", username: str(args.username),
            tokenRef: str(args.tokenRef), passwordRef: str(args.passwordRef), keyPath: str(args.keyPath),
            caFile: str(args.caFile), allowInsecure: args.allowInsecure === true,
            defaultBranch: str(args.defaultBranch) || "main",
          });
          const ref = secretRefOf(created);
          const info = ref ? await describeRef(ctx, ref) : { configured: false };
          const hint = info.configured === true
            ? "Its key is already present at " + ref + "."
            : "Next: store the key for reference " + (ref || "(none)") + " in Settings > Git Connector, then run git_provider_test.";
          return { ok: true, provider: { ...created, secretRef: ref, secretSet: info.configured === true, secretSource: info.source || "" }, hint };
        },
      });

      add({
        name: "git_provider_update",
        description: "Update a saved provider (base URLs, account, refs, TLS policy). Partial: omit fields to keep them.",
        parameters: { provider: { type: "string", description: "Provider name or id to update." }, ...PROVIDER_PROPS },
        output: { schema: OUT_OK({ provider: PROVIDER_ITEM }), render: safe((_a, v) => (v.provider ? "Provider updated: " + v.provider.name + " [" + v.provider.kind + "] api=" + v.provider.apiBaseUrl : "Provider updated.")) },
        async execute(args) {
          const existing = store.findProvider(str(args.provider));
          if (!existing) throw new Error("provider " + JSON.stringify(args.provider) + " not found");
          const patch = {};
          for (const key of ["name", "kind", "baseUrl", "apiBaseUrl", "gitBaseUrl", "authType", "username", "tokenRef", "passwordRef", "keyPath", "caFile", "defaultBranch"]) {
            if (args[key] !== undefined && args[key] !== null && str(args[key]) !== "") patch[key] = str(args[key]);
          }
          if (args.allowInsecure !== undefined) patch.allowInsecure = args.allowInsecure === true;
          if (Object.keys(patch).length === 0) throw new Error("git_provider_update: nothing to update");
          const updated = store.upsertProvider(patch, existing.id);
          const ref = secretRefOf(updated);
          const info = ref ? await describeRef(ctx, ref) : { configured: false };
          return { ok: true, provider: { ...updated, secretRef: ref, secretSet: info.configured === true, secretSource: info.source || "" } };
        },
      });

      add({
        name: "git_provider_remove",
        description: "Delete a saved provider. Set clearCredentials=true to also remove its stored key from the DSH credential center. Refuses while repo profiles still use the provider.",
        parameters: {
          provider: { type: "string", description: "Provider name or id." },
          clearCredentials: { type: "boolean", description: "Also delete the stored key (default false)." },
        },
        output: {
          schema: OUT_OK({
            removed: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, name: { type: "string" }, kind: { type: "string" } } },
            clearRequested: { type: "boolean" },
            ref: { type: "string" },
            cleared: STR_ARRAY,
            skipped: { type: "array", items: { type: "object", additionalProperties: false, properties: { ref: { type: "string" }, reason: { type: "string" } } } },
          }),
          render: safe((_a, v) => {
            const lines = [v.removed ? "Removed provider " + v.removed.name + " (" + v.removed.kind + ")." : "Provider removed."];
            if (v.cleared?.length) lines.push("Cleared key: " + v.cleared.join(", "));
            if (v.skipped?.length) lines.push("Kept: " + v.skipped.map((s) => s.ref + " (" + s.reason + ")").join(", "));
            return lines.join("\n");
          }),
        },
        async execute(args) {
          const report = await removeProviderWithCreds(ctx, store, str(args.provider), args.clearCredentials === true);
          return { ok: true, ...report };
        },
      });

      add({
        name: "git_provider_test",
        description: "Test a provider's connectivity and authentication: reads the forge version, then verifies the stored key by resolving the authenticated account. Use to diagnose a missing/incorrect key before cloning or pushing.",
        parameters: { provider: { type: "string", description: "Provider name or id." } },
        output: {
          schema: OUT_OK({
            provider: { type: "string" }, kind: { type: "string" },
            apiBaseUrl: { type: "string" }, gitBaseUrl: { type: "string" },
            tokenSet: { type: "boolean" }, tlsInsecure: { type: "boolean" },
            version: { type: "string" }, authenticated: { type: "boolean" },
            login: { type: "string" }, error: { type: "string" }, durationMs: { type: "number" },
          }),
          render: safe((_a, v) => {
            const lines = [(v.ok ? "OK" : "FAILED") + " - " + v.provider + " [" + (v.kind || "?") + "] @ " + v.apiBaseUrl + (v.tlsInsecure ? "  (TLS verification DISABLED)" : "")];
            lines.push("forge version: " + (v.version || "unknown"));
            lines.push("key: " + (v.tokenSet ? "set" : "NOT SET") + (v.authenticated ? " - authenticated as " + (v.login || "?") : ""));
            if (v.error) lines.push("error: " + v.error);
            return lines.join("\n");
          }),
        },
        async execute(args) {
          const { providerTest } = await import("./routes.js");
          return providerTest(ctx, store, cfg, str(args.provider));
        },
      });

      // ---------------------------------------------------------------- repo profiles
      add({
        name: "git_repo_list",
        description: "List saved git repo profiles. Each profile has a NAME that is the handle for every other git tool - pass it as the 'repo' argument. Shows the remote URL, the local work-copy path, local state, and each profile's active safety flags.",
        parameters: {},
        output: {
          schema: OUT_OK({ count: { type: "number" }, repos: { type: "array", items: { ...REPO_ITEM, properties: { ...REPO_ITEM.properties, local: LOCAL_ITEM, flagDetails: { type: "array", items: FLAG_ITEM }, tlsInsecure: { type: "boolean" } } } } }),
          render: safe((_a, v) => {
            if (!v.repos?.length) return "No repo profiles saved yet. Create one with git_repo_add (name + providerRef + owner + repo).";
            return v.repos.map((r) => {
              const local = r.local?.present ? (r.local.isRepo ? "local ok @ " + (r.local.head || "?") + (r.local.remoteMatches === false ? " (REMOTE MISMATCH: " + r.local.remoteUrl + ")" : "") : "local dir present but NOT a git work copy") : "not cloned yet";
              const flags = (r.flagDetails || []).filter((f) => f.value === true).map((f) => f.key).join(",");
              return r.name + " -> " + r.remoteUrl + "\n    path: " + r.localPath + "\n    " + local + (flags ? "\n    active flags: " + flags : "");
            }).join("\n");
          }),
        },
        async execute() {
          const repos = [];
          for (const repo of store.listRepos()) {
            const raw = store.findRepo(repo.id);
            const provider = store.providerOf(raw);
            const { flags } = repoContext(store, cfg, raw);
            const local = await localRepoState(ctx, store, cfg, raw).catch(() => ({ present: false, isRepo: false, head: "", remoteMatches: null, remoteUrl: "" }));
            repos.push({ ...repo, local, flagDetails: publicFlags(raw, provider ?? {}, cfg), tlsInsecure: flags.insecureTls === true });
          }
          return { ok: true, count: repos.length, repos };
        },
      });

      add({
        name: "git_repo_add",
        description: "Save a repo profile. The profile NAME becomes the handle for every git/forge tool ('repo' argument). The remote URL is derived from the provider's gitBaseUrl plus owner/repo. Per-repo safety flags (TLS bypass, overwrite, force push, read-only) are set here.",
        parameters: {
          name: { type: "string", description: "Unique profile name, e.g. 'dsh-git-connector'. This is how the agent refers to the repo." },
          providerRef: { type: "string", description: "Provider name (or id) this repo belongs to." },
          owner: { type: "string", description: "Owner/org, e.g. 'sycada'." },
          repo: { type: "string", description: "Repository name, e.g. 'dsh-git-connector'." },
          remoteUrl: { type: "string", description: "Explicit remote URL (only with allowRawUrl, or to override derivation)." },
          localPath: { type: "string", description: "Local work-copy directory (default: <workspaceRoot>/<owner>/<repo>)." },
          defaultBranch: { type: "string", description: "Default branch for this repo." },
          flags: FREE_OBJECT,
        },
        output: {
          schema: OUT_OK({ repo: REPO_ITEM, flags: { type: "array", items: FLAG_ITEM } }),
          render: safe((_a, v) => {
            const r = v.repo;
            if (!r) return "Repo profile saved.";
            const on = (v.flags || []).filter((f) => f.value === true).map((f) => f.key);
            return "Saved repo profile \"" + r.name + "\"\n  remote: " + r.remoteUrl + "\n  local : " + r.localPath + "\n  branch: " + r.defaultBranch + "\n  flags : " + (on.length ? on.join(", ") : "(all default)");
          }),
        },
        async execute(args) {
          const created = store.upsertRepo({
            name: str(args.name), providerRef: str(args.providerRef), owner: str(args.owner), repo: str(args.repo),
            remoteUrl: str(args.remoteUrl), localPath: str(args.localPath),
            defaultBranch: str(args.defaultBranch),
            flags: args.flags && typeof args.flags === "object" ? args.flags : undefined,
          });
          const raw = store.findRepo(created.id);
          const provider = store.providerOf(raw);
          return { ok: true, repo: created, flags: publicFlags(raw, provider ?? {}, cfg) };
        },
      });

      add({
        name: "git_repo_update",
        description: "Update a saved repo profile. Partial: omit fields to keep them. Flags use PATCH semantics - set an individual flag to change just that one, or pass null to clear it back to the global/default value.",
        parameters: {
          repo: { type: "string", description: "Profile name or id to update." },
          name: { type: "string" }, providerRef: { type: "string" }, owner: { type: "string" },
          repoName: { type: "string", description: "New repository name (the 'repo' profile field)." },
          remoteUrl: { type: "string" }, localPath: { type: "string" }, defaultBranch: { type: "string" },
          flags: FREE_OBJECT,
        },
        output: { schema: OUT_OK({ repo: REPO_ITEM, flags: { type: "array", items: FLAG_ITEM } }), render: safe((_a, v) => (v.repo ? "Updated repo profile \"" + v.repo.name + "\" (" + v.repo.remoteUrl + ")" : "Repo profile updated.")) },
        async execute(args) {
          const existing = store.findRepo(str(args.repo));
          if (!existing) {
            const names = store.repoNames();
            throw new Error("repo profile " + JSON.stringify(args.repo) + " not found - saved profiles: " + (names.join(", ") || "(none)"));
          }
          const patch = {};
          if (str(args.name)) patch.name = str(args.name);
          if (str(args.providerRef)) patch.providerRef = str(args.providerRef);
          if (str(args.owner)) patch.owner = str(args.owner);
          if (str(args.repoName)) patch.repo = str(args.repoName);
          if (str(args.remoteUrl)) patch.remoteUrl = str(args.remoteUrl);
          if (str(args.localPath)) patch.localPath = str(args.localPath);
          if (str(args.defaultBranch)) patch.defaultBranch = str(args.defaultBranch);
          if (args.flags && typeof args.flags === "object") patch.flags = args.flags;
          if (Object.keys(patch).length === 0) throw new Error("git_repo_update: nothing to update");
          const updated = store.upsertRepo(patch, existing.id);
          const raw = store.findRepo(updated.id);
          const provider = store.providerOf(raw);
          return { ok: true, repo: updated, flags: publicFlags(raw, provider ?? {}, cfg) };
        },
      });

      add({
        name: "git_repo_remove",
        description: "Delete a saved repo profile. This never touches the local work copy or the remote repository - it only forgets the profile. Provider keys are shared and are not removed here.",
        parameters: { repo: { type: "string", description: "Profile name or id." } },
        output: {
          schema: OUT_OK({ removed: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, name: { type: "string" } } }, localPathKept: { type: "string" } }),
          render: safe((_a, v) => (v.removed ? "Removed repo profile " + v.removed.name + ". Local work copy left untouched at " + v.localPathKept : "Repo profile removed.")),
        },
        async execute(args) {
          const existing = store.findRepo(str(args.repo));
          if (!existing) throw new Error("repo profile " + JSON.stringify(args.repo) + " not found");
          const localPath = existing.localPath;
          const removed = store.removeRepo(existing.id);
          return { ok: true, removed: { id: removed.id, name: removed.name }, localPathKept: localPath };
        },
      });

      // ---------------------------------------------------------------- git operations
      add({
        name: "git_clone",
        description: "Clone a saved repo profile's remote into its local work copy. Refuses when the target already holds files unless the profile's overwriteLocal flag is on, in which case the old directory is moved aside and its path returned for rollback.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name (the handle)." },
          branch: { type: "string", description: "Branch to clone (default: the remote default)." },
          depth: { type: "number", description: "Shallow clone depth." },
        },
        output: {
          schema: OUT_OK({
            backupPath: { type: "string" },
            command: STR_ARRAY,
            exitCode: NUMBER_OR_NULL,
            stdout: { type: "string" },
            stderr: { type: "string" },
            durationMs: { type: "number" },
            tlsInsecure: { type: "boolean" },
            usedToken: { type: "boolean" },
          }),
          render: safe((_a, v) => {
            const lines = [v.ok ? "clone OK" : "clone FAILED"];
            if (v.backupPath) lines.push("previous directory moved to: " + v.backupPath);
            if (v.tlsInsecure) lines.push("WARNING: TLS certificate verification was disabled for this clone.");
            if (!v.ok && v.stderr) lines.push(v.stderr);
            if (v.ok && v.stdout) lines.push(v.stdout.trim());
            return lines.join("\n");
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitClone(ctx, store, cfg, repo, { branch: str(args.branch), depth: args.depth });
        },
      });

      add({
        name: "git_fetch",
        description: "Fetch from a repo profile's origin. Pruning follows the profile's fetchPrune flag (default on). A forced fetch needs the profile's overwriteLocal flag.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name." },
          prune: { type: "boolean", description: "Override the profile's fetchPrune flag." },
          all: { type: "boolean", description: "Fetch all remotes." },
          remote: { type: "string", description: "Remote name (default origin)." },
          force: { type: "boolean", description: "Force fetch (needs overwriteLocal)." },
        },
        output: { schema: OUT_OK(GIT_RUN_OUT), render: safe((_a, v) => [v.ok ? "fetch OK" : "fetch FAILED", v.ok ? "" : v.stderr, v.tlsInsecure ? "WARNING: TLS verification disabled." : ""].filter(Boolean).join("\n")) },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitFetch(ctx, store, cfg, repo, { prune: args.prune, all: args.all === true, remote: str(args.remote), force: args.force === true });
        },
      });

      add({
        name: "git_pull",
        description: "Pull into the current branch (fast-forward only by default). If the work copy has uncommitted changes this is refused unless the profile's overwriteLocal flag is on - in which case the changes are parked on a git stash first and the stash ref is returned.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name." },
          rebase: { type: "boolean", description: "Rebase instead of fast-forward only." },
          remote: { type: "string" }, branch: { type: "string" },
        },
        output: {
          schema: OUT_OK({
            ...GIT_RUN_OUT,
            stashed: { type: "boolean" },
            stashRef: { type: "string" },
            stashMessage: { type: "string" },
            restoreHint: { type: "string" },
            error: { type: "string" },
          }),
          render: safe((_a, v) => {
            const lines = [v.ok ? "pull OK" : "pull FAILED"];
            if (v.stashed) lines.push("local changes were parked at " + v.stashRef + " - " + v.restoreHint);
            if (!v.ok && (v.error || v.stderr)) lines.push(v.error || v.stderr);
            if (v.ok && v.stdout) lines.push(v.stdout.trim());
            return lines.join("\n");
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitPull(ctx, store, cfg, repo, { rebase: args.rebase === true, remote: str(args.remote), branch: str(args.branch) });
        },
      });

      add({
        name: "git_push",
        description: "Push the current branch to origin. A force push is refused unless ALL of: confirmForce is true, the profile's allowForcePush flag is on, the profile's overwriteRemote flag is on (repo-only, off by default), and the target is not the default branch. Every force push returns the previous remote SHA for rollback.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name." },
          branch: { type: "string", description: "Branch to push (default: the checked-out branch)." },
          force: { type: "boolean", description: "Force push (see the four gates in the description)." },
          confirmForce: { type: "boolean", description: "Explicit confirmation required alongside force." },
          setUpstream: { type: "boolean", description: "Set the upstream (-u)." },
        },
        output: {
          schema: OUT_OK({
            ...GIT_RUN_OUT,
            branch: { type: "string" },
            forced: { type: "boolean" },
            remoteShaBefore: { type: "string" },
            rollbackHint: { type: "string" },
          }),
          render: safe((_a, v) => {
            const lines = [(v.ok ? "push OK" : "push FAILED") + " (" + (v.branch || "?") + (v.forced ? ", forced" : "") + ")"];
            if (v.rollbackHint) lines.push(v.rollbackHint);
            if (!v.ok && v.stderr) lines.push(v.stderr);
            if (v.ok && v.stdout) lines.push(v.stdout.trim());
            return lines.join("\n");
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitPush(ctx, store, cfg, repo, { branch: str(args.branch), force: args.force === true, confirmForce: args.confirmForce === true, setUpstream: args.setUpstream === true });
        },
      });

      add({
        name: "git_status",
        description: "Show a repo profile's work-copy state: current branch, upstream, ahead/behind counts, staged and modified files, untracked files and conflicts.",
        parameters: { repo: { type: "string", description: "Saved repo profile name." } },
        output: {
          schema: OUT_OK({
            branch: { type: "string" }, upstream: { type: "string" },
            ahead: { type: "number" }, behind: { type: "number" },
            detached: { type: "boolean" }, clean: { type: "boolean" },
            staged: STR_ARRAY, modified: STR_ARRAY, untracked: STR_ARRAY,
            conflicted: STR_ARRAY, renamed: STR_ARRAY,
            error: { type: "string" },
            tlsInsecure: { type: "boolean" },
          }),
          render: safe((_a, v) => {
            if (!v.ok) return "status FAILED: " + (v.error || "");
            const lines = ["branch " + (v.branch || "(detached)") + (v.upstream ? " -> " + v.upstream : "") + (v.ahead || v.behind ? " [" + (v.ahead ? "+" + v.ahead : "") + (v.behind ? "-" + v.behind : "") + "]" : "")];
            if (v.tlsInsecure) lines.push("WARNING: TLS certificate verification is disabled for this repo.");
            if (v.clean) lines.push("working tree clean");
            for (const [label, list] of [["staged", v.staged], ["modified", v.modified], ["untracked", v.untracked], ["conflicted", v.conflicted]]) {
              if (list?.length) lines.push(label + " (" + list.length + "): " + list.slice(0, 40).join(", "));
            }
            return lines.join("\n");
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitStatus(ctx, store, cfg, repo);
        },
      });

      add({
        name: "git_diff",
        description: "Show the diff of a repo profile's work copy (unstaged by default, or staged). Output is line-capped; the result reports the true total so you know it was truncated.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name." },
          staged: { type: "boolean", description: "Show staged changes instead of unstaged." },
          stat: { type: "boolean", description: "Summary stat instead of a full diff." },
          path: { type: "string", description: "Limit to one path." },
          maxLines: { type: "number", description: "Line cap (default 2000)." },
        },
        output: {
          schema: OUT_OK({ files: STR_ARRAY, diff: { type: "string" }, totalLines: { type: "number" }, truncated: { type: "boolean" } }),
          render: safe((_a, v) => {
            if (!v.diff) return v.ok ? "(no changes)" : "diff failed";
            const head = "diff: " + (v.files?.length ?? 0) + " file(s), " + v.totalLines + " line(s)" + (v.truncated ? " [truncated]" : "");
            return head + "\n" + v.diff;
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitDiff(ctx, store, cfg, repo, { staged: args.staged === true, stat: args.stat === true, path: str(args.path), maxLines: args.maxLines });
        },
      });

      add({
        name: "git_log",
        description: "Show recent commits of a repo profile as structured records (sha, author, email, ISO date, subject). Use to inspect history or confirm this plugin's own commits.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name." },
          limit: { type: "number", description: "How many commits (default 20, max 200)." },
          path: { type: "string", description: "Limit to one path." },
          branch: { type: "string", description: "Limit to one branch." },
        },
        output: {
          schema: OUT_OK({
            commits: { type: "array", items: { type: "object", additionalProperties: false, properties: { sha: { type: "string" }, author: { type: "string" }, email: { type: "string" }, date: { type: "string" }, subject: { type: "string" } } } },
            error: { type: "string" },
          }),
          render: safe((_a, v) => {
            if (!v.ok) return "log FAILED: " + (v.error || "");
            if (!v.commits?.length) return "(no commits)";
            return v.commits.map((c) => c.sha.slice(0, 8) + "  " + c.date.slice(0, 10) + "  " + c.author + "  " + c.subject).join("\n");
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitLog(ctx, store, cfg, repo, { limit: args.limit, path: str(args.path), branch: str(args.branch) });
        },
      });

      add({
        name: "git_commit",
        description: "Stage and commit in a repo profile's work copy. Commits are always signed with this plugin's own identity (dsh-git-connector, plus the profile's commitIdentity tag) so your commits stay distinguishable from the user's and from other agents'.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name." },
          message: { type: "string", description: "Commit message." },
          paths: { type: "array", items: { type: "string" }, description: "Stage only these paths (default: everything)." },
        },
        output: {
          schema: OUT_OK({
            committed: { type: "boolean" },
            identity: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, email: { type: "string" } } },
            sha: { type: "string" },
            stage: { type: "string" },
            note: { type: "string" },
            error: { type: "string" },
            stdout: { type: "string" },
            stderr: { type: "string" },
          }),
          render: safe((_a, v) => {
            if (!v.ok) return "commit FAILED (" + (v.stage || "?") + "): " + (v.error || "");
            if (v.committed === false) return v.note || "nothing to commit";
            return "committed " + (v.sha || "").slice(0, 8) + " as " + v.identity?.name + " <" + v.identity?.email + ">";
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitCommit(ctx, store, cfg, repo, { message: str(args.message), paths: Array.isArray(args.paths) ? args.paths : undefined });
        },
      });

      add({
        name: "git_branch",
        description: "List, create, checkout or delete branches in a repo profile's work copy. Deleting an unmerged branch is refused unless the profile's overwriteLocal flag is on; the deleted commit SHA is always reported.",
        parameters: {
          repo: { type: "string", description: "Saved repo profile name." },
          action: { type: "string", enum: ["list", "create", "checkout", "delete"], description: "What to do (default list)." },
          name: { type: "string", description: "Branch name (required except for list)." },
          startPoint: { type: "string", description: "Start point for create." },
          create: { type: "boolean", description: "With checkout: create the branch (checkout -b)." },
        },
        output: {
          schema: OUT_OK({
            action: { type: "string" },
            name: { type: "string" },
            forced: { type: "boolean" },
            deletedSha: { type: "string" },
            error: { type: "string" },
            branches: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, sha: { type: "string" }, upstream: { type: "string" }, current: { type: "boolean" } } } },
          }),
          render: safe((_a, v) => {
            if (!v.ok) return "branch " + (v.action || "") + " FAILED: " + (v.error || "");
            if (v.action === "list") return (v.branches || []).map((b) => (b.current ? "* " : "  ") + b.name + "  " + b.sha + (b.upstream ? "  -> " + b.upstream : "")).join("\n") || "(no branches)";
            const extra = v.forced ? " (forced; deleted commit was " + (v.deletedSha || "?") + ")" : "";
            return "branch " + v.action + " " + v.name + " ok" + extra;
          }),
        },
        async execute(args) {
          const repo = requireRepo(store, str(args.repo));
          return gitBranch(ctx, store, cfg, repo, { action: str(args.action) || "list", name: str(args.name), startPoint: str(args.startPoint), create: args.create === true });
        },
      });

      // ---------------------------------------------------------------- forge API
      add({
        name: "forge_repo_list",
        description: "List repositories on a forge (Gitea/Forgejo/GitHub) that the stored key can access. Pass a saved repo profile to use its provider, or provider + owner.",
        parameters: { ...FORGE_TARGET_PROPS, limit: { type: "number", description: "Max repos (default 50)." } },
        output: {
          schema: OUT_OK({ count: { type: "number" }, repos: { type: "array", items: FORGE_REPO_ITEM } }),
          render: safe((_a, v) => (v.repos?.length ? v.repos.map((r) => r.fullName + (r.private ? " [private]" : "") + (r.empty ? " (empty)" : "") + "  " + r.htmlUrl).join("\n") : "(no repositories visible to this key)")),
        },
        async execute(args) {
          const target = forgeTarget(store, cfg, args, { needCoords: false });
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, target.profile, target.provider);
          const repos = await forge.listRepos({ provider: target.provider, token, tls, timeoutMs, limit: args.limit });
          return { ok: true, count: repos.length, repos };
        },
      });

      add({
        name: "forge_repo_create",
        description: "Create a repository on a forge. Needs a provider (a repo profile cannot pre-exist for a new repo).",
        parameters: {
          provider: { type: "string", description: "Provider name to create the repo on." },
          name: { type: "string", description: "Repository name." },
          private: { type: "boolean", description: "Create as private." },
          autoInit: { type: "boolean", description: "Initialise with a README so the repo is not empty." },
          description: { type: "string", description: "Repository description." },
        },
        output: { schema: OUT_OK({ repo: FORGE_REPO_ITEM }), render: safe((_a, v) => (v.repo ? "created " + v.repo.fullName + (v.repo.private ? " [private]" : "") + "  " + v.repo.htmlUrl : "repo created")) },
        async execute(args) {
          const providerRef = str(args.provider);
          const provider = store.findProvider(providerRef);
          if (!provider) throw new Error("provider " + JSON.stringify(providerRef) + " not found - known providers: " + (store.listProviders().map((p) => p.name).join(", ") || "(none)"));
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, null, provider);
          const repo = await forge.createRepo({ provider, token, tls, timeoutMs, name: str(args.name), private: args.private === true, autoInit: args.autoInit === true, description: str(args.description) });
          return { ok: true, repo };
        },
      });

      add({
        name: "forge_repo_info",
        description: "Read one repository's metadata from a forge (default branch, visibility, clone URLs, whether it is empty).",
        parameters: FORGE_TARGET_PROPS,
        output: { schema: OUT_OK({ repo: FORGE_REPO_ITEM }), render: safe((_a, v) => { const r = v.repo; if (!r) return "not found"; return [r.fullName + (r.private ? " [private]" : ""), "default branch: " + (r.defaultBranch || "?"), "empty: " + (r.empty === true), "clone: " + r.cloneUrl, r.htmlUrl].join("\n"); }) },
        async execute(args) {
          const target = forgeTarget(store, cfg, args);
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, target.profile, target.provider);
          const repo = await forge.repoInfo({ provider: target.provider, token, tls, timeoutMs, owner: target.owner, repo: target.repository });
          return { ok: true, repo };
        },
      });

      add({
        name: "forge_branch_list",
        description: "List branches of a repository on a forge (server-side, no local work copy needed).",
        parameters: { ...FORGE_TARGET_PROPS, limit: { type: "number" } },
        output: {
          schema: OUT_OK({ count: { type: "number" }, branches: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, sha: { type: "string" } } } } }),
          render: safe((_a, v) => (v.branches?.length ? v.branches.map((b) => b.name + "  " + (b.sha || "").slice(0, 8)).join("\n") : "(no branches - the repository may be empty)")),
        },
        async execute(args) {
          const target = forgeTarget(store, cfg, args);
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, target.profile, target.provider);
          const branches = await forge.listBranches({ provider: target.provider, token, tls, timeoutMs, owner: target.owner, repo: target.repository, limit: args.limit });
          return { ok: true, count: branches.length, branches };
        },
      });

      add({
        name: "forge_contents",
        description: "List a directory (or read a file entry) in a repository on a forge, without cloning. An empty repository legitimately returns an error.",
        parameters: { ...FORGE_TARGET_PROPS, path: { type: "string", description: "Directory or file path (default: repo root)." }, ref: { type: "string", description: "Branch, tag or commit (default: default branch)." } },
        output: {
          schema: OUT_OK({ count: { type: "number" }, entries: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, path: { type: "string" }, type: { type: "string" }, size: { type: "number" }, sha: { type: "string" } } } } }),
          render: safe((_a, v) => (v.entries?.length ? v.entries.map((e) => (e.type === "dir" ? "d " : "f ") + e.path + (e.type === "file" ? "  (" + e.size + " B)" : "")).join("\n") : "(empty)")),
        },
        async execute(args) {
          const target = forgeTarget(store, cfg, args);
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, target.profile, target.provider);
          const entries = await forge.getContents({ provider: target.provider, token, tls, timeoutMs, owner: target.owner, repo: target.repository, path: str(args.path), ref: str(args.ref) });
          return { ok: true, count: entries.length, entries };
        },
      });

      add({
        name: "forge_pull_list",
        description: "List pull requests of a repository on a forge.",
        parameters: { ...FORGE_TARGET_PROPS, state: { type: "string", enum: ["open", "closed", "all"], description: "Filter by state (default open)." }, limit: { type: "number" } },
        output: {
          schema: OUT_OK({ count: { type: "number" }, pulls: { type: "array", items: PULL_ITEM } }),
          render: safe((_a, v) => (v.pulls?.length ? v.pulls.map((p) => "#" + p.number + " [" + p.state + "] " + p.title + " (" + p.head + " -> " + p.base + ")" + (p.merged ? " merged" : "")).join("\n") : "(no pull requests)")),
        },
        async execute(args) {
          const target = forgeTarget(store, cfg, args);
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, target.profile, target.provider);
          const pulls = await forge.listPulls({ provider: target.provider, token, tls, timeoutMs, owner: target.owner, repo: target.repository, state: str(args.state) || "open", limit: args.limit });
          return { ok: true, count: pulls.length, pulls };
        },
      });

      add({
        name: "forge_pull_create",
        description: "Open a pull request on a forge from an existing head branch into a base branch.",
        parameters: { ...FORGE_TARGET_PROPS, title: { type: "string", description: "Pull request title." }, head: { type: "string", description: "Source branch." }, base: { type: "string", description: "Target branch." }, body: { type: "string", description: "Description." } },
        output: { schema: OUT_OK({ pull: PULL_ITEM }), render: safe((_a, v) => (v.pull ? "opened PR #" + v.pull.number + " " + v.pull.title + " (" + v.pull.head + " -> " + v.pull.base + ")  " + v.pull.htmlUrl : "PR created")) },
        async execute(args) {
          const target = forgeTarget(store, cfg, args);
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, target.profile, target.provider);
          const pull = await forge.createPull({ provider: target.provider, token, tls, timeoutMs, owner: target.owner, repo: target.repository, title: str(args.title), head: str(args.head), base: str(args.base) || target.profile?.defaultBranch || target.provider.defaultBranch, body: str(args.body) });
          return { ok: true, pull };
        },
      });

      add({
        name: "forge_issue_create",
        description: "Open an issue on a forge.",
        parameters: { ...FORGE_TARGET_PROPS, title: { type: "string", description: "Issue title." }, body: { type: "string", description: "Issue body." } },
        output: {
          schema: OUT_OK({ issue: { type: "object", additionalProperties: false, properties: { number: { type: "number" }, title: { type: "string" }, htmlUrl: { type: "string" } } } }),
          render: safe((_a, v) => (v.issue ? "opened issue #" + v.issue.number + " " + v.issue.title + "  " + v.issue.htmlUrl : "issue created")),
        },
        async execute(args) {
          const target = forgeTarget(store, cfg, args);
          const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, target.profile, target.provider);
          const issue = await forge.createIssue({ provider: target.provider, token, tls, timeoutMs, owner: target.owner, repo: target.repository, title: str(args.title), body: str(args.body) });
          return { ok: true, issue };
        },
      });

      // ---------------------------------------------------------------- credentials
      add({
        name: "git_credential_status",
        description: "Report which credential reference backs each provider and whether a value is currently stored (never the value itself). Use when authentication fails, to tell the user exactly which reference to fill in.",
        parameters: { provider: { type: "string", description: "Limit to one provider name or id." } },
        output: {
          schema: OUT_OK({
            entries: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  provider: { type: "string" }, kind: { type: "string" }, authType: { type: "string" },
                  ref: { type: "string" }, configured: { type: "boolean" },
                  source: { type: "string" }, writable: { type: "boolean" },
                },
              },
            },
          }),
          render: safe((_a, v) => {
            if (!v.entries?.length) return "No providers saved yet.";
            return v.entries.map((e) => e.provider + " [" + e.kind + "]: " + (e.ref || "(no secret ref)") + " -> " + (e.configured ? "SET" + (e.source ? " (from " + e.source + ")" : "") : "NOT SET - store it in Settings > Git Connector")).join("\n");
          }),
        },
        async execute(args) {
          const only = str(args.provider);
          const providers = only ? [store.findProvider(only)].filter(Boolean) : store.listProviders();
          if (only && providers.length === 0) throw new Error("provider " + JSON.stringify(only) + " not found");
          const entries = [];
          for (const p of providers) {
            const ref = secretRefOf(p);
            const info = ref ? await describeRef(ctx, ref) : { configured: false, source: "", writable: false };
            entries.push({ provider: p.name, kind: p.kind, authType: p.authType, ref, configured: info.configured === true, source: info.source || "", writable: info.writable === true });
          }
          return { ok: true, entries };
        },
      });

      return () => { for (const d of disposers) { try { d(); } catch { /* ignore */ } } };
    }, "dsh-git-connector: tools");
  });
}
