/**
 * dsh-git-connector - DeepSeek Harness plugin (host half).
 *
 * Provides:
 *  - saved forge providers and repo profiles (~/.dsh/dsh-git-connector/store.json),
 *    secrets only via the DSH credentials center (refs, never values);
 *  - agent tools git_provider_* / git_repo_* / git_* / forge_* / git_credential_status;
 *  - git work-copy operations driven by an ephemeral GIT_ASKPASS helper;
 *  - forge REST tools (Gitea/Forgejo/GitHub) with per-request TLS control;
 *  - a Settings card (client.js) and a system-prompt section.
 */
import { createStore } from "./store.js";
import { registerRoutes } from "./routes.js";
import { registerTools } from "./tools.js";
import { resolveGitBinary, gitVersion } from "./git.js";
import { sweepAskpass } from "./askpass.js";
import { workspaceRootOf } from "./paths.js";

export const name = "dsh-git-connector";
export const inject = [];

const DEFAULTS = {
  gitPath: "",
  gitTimeoutMs: 300000,
  gitOutputLimit: 1048576,
  workspaceRoot: "",
  allowOutsideWorkspace: false,
  allowForcePush: false,
  allowRawUrl: false,
  allowInsecure: false,
  httpTimeoutMs: 30000,
  maxOutputLines: 2000,
  promptSectionOrder: 570,
  instanceLabel: "",
  trustedHosts: [],
};

const BOOLEAN_KEYS = ["allowOutsideWorkspace", "allowForcePush", "allowRawUrl", "allowInsecure"];
const NUMBER_KEYS = ["gitTimeoutMs", "gitOutputLimit", "httpTimeoutMs", "maxOutputLines", "promptSectionOrder"];

export function resolveConfig(config = {}) {
  const resolved = { ...DEFAULTS };
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === "trustedHosts") {
      if (Array.isArray(value)) resolved.trustedHosts = value.map(String);
      continue;
    }
    if (BOOLEAN_KEYS.includes(key)) { resolved[key] = value === true; continue; }
    if (NUMBER_KEYS.includes(key)) {
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) resolved[key] = num;
      continue;
    }
    if (typeof value === "string") resolved[key] = value;
  }
  return resolved;
}

/** Cordis plugin entry. */
export function apply(ctx, config = {}) {
  const cfg = resolveConfig(config);
  const store = createStore(cfg);

  // Reap askpass helpers left behind by an earlier crashed run.
  try { sweepAskpass(); } catch { /* best effort */ }

  const promptText = () => {
    const providers = store.listProviders();
    const repos = store.listRepos();
    const providerLines = providers.length === 0
      ? "none saved yet (add one with git_provider_add, or in Settings > Git Connector)"
      : providers.map((p) => p.name + " [" + p.kind + "] " + p.apiBaseUrl + " (key ref " + p.tokenRef + ")").join("\n");
    const repoLines = repos.length === 0
      ? "none saved yet (add one with git_repo_add)"
      : repos.map((r) => r.name + " -> " + r.remoteUrl + "  local: " + r.localPath + "  default branch: " + r.defaultBranch).join("\n");
    return [
      "## Git repositories (dsh-git-connector)",
      "",
      "You have first-class git tools. Reach a repository by its SAVED PROFILE NAME - never rebuild a remote URL by hand.",
      "",
      "Tools: git_repo_list, git_repo_add, git_repo_update, git_repo_remove, git_provider_list, git_provider_add, git_provider_update, git_provider_remove, git_provider_test, git_credential_status, git_clone, git_fetch, git_pull, git_push, git_status, git_branch, git_diff, git_log, git_commit, forge_repo_list, forge_repo_create, forge_repo_info, forge_branch_list, forge_contents, forge_pull_list, forge_pull_create, forge_issue_create.",
      "",
      "Providers:",
      providerLines,
      "",
      "Repo profiles (pass the name as the repo argument):",
      repoLines,
      "",
      "- Never ask the user to paste a token into chat. Keys live in the DSH credentials center; if one is missing, run git_credential_status and point the user at Settings > Git Connector.",
      "- Commits you create are signed as dsh-git-connector (plus the profile's commitIdentity tag) so they stay distinguishable from the user's work.",
      "- Destructive operations are gated per repo profile: overwriteLocal, overwriteRemote, allowForcePush, insecureTls, readOnly. A refusal names the exact flag to change; do not work around it.",
      "- Prefer git_status before git_pull or git_push, and read the result's rollback hint after any forced operation.",
      "",
    ].join("\n");
  };

  // --- system prompt section, rebuilt whenever profiles change ---
  let refreshPromptRef = () => {};
  const refreshPrompt = () => { try { refreshPromptRef(); } catch { /* ignore */ } };
  ctx.inject(["systemPrompt"], (sctx) => {
    sctx.effect(() => {
      let sectionDispose = null;
      const register = () => {
        if (sectionDispose) return;
        try {
          sectionDispose = sctx.systemPrompt.section({
            name: "dsh-git-connector:capabilities",
            order: cfg.promptSectionOrder,
            text: promptText(),
          });
        } catch (error) {
          ctx.logger?.warn?.("dsh-git-connector: prompt section failed: " + String(error?.message ?? error));
        }
      };
      refreshPromptRef = () => {
        if (sectionDispose) { try { sectionDispose(); } catch { /* ignore */ } sectionDispose = null; }
        register();
      };
      register();
      return () => {
        if (sectionDispose) { try { sectionDispose(); } catch { /* ignore */ } sectionDispose = null; }
        refreshPromptRef = () => {};
      };
    }, "dsh-git-connector: capabilities prompt section");
  });
  store.on(refreshPrompt);

  // --- HTTP API for the Settings card ---
  ctx.inject(["webServer"], (sctx) => {
    sctx.effect(() => {
      const { teardown } = registerRoutes(sctx, { store, cfg });
      return teardown;
    }, "dsh-git-connector: http routes");
  });

  // --- agent tools ---
  registerTools(ctx, { store, cfg });

  ctx.logger?.info?.("dsh-git-connector: ready (workspace root " + workspaceRootOf(cfg) + ")");
  return { store, cfg, resolveGitBinary, gitVersion };
}

export default { name, inject, apply, resolveConfig };
