/**
 * dsh-git-connector - data store (providers + repo profiles).
 *
 * Everything is JSON under <DSH_HOME>/dsh-git-connector/store.json. This file
 * NEVER holds a secret: tokens / passwords / key passphrases live in the DSH
 * credentials center and only their REFERENCE NAMES appear here.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storePaths, defaultLocalPath, assertLocalPath } from "./paths.js";
import { sanitizeFlags, resolveFlags } from "./flags.js";

export const STORE_VERSION = 1;
export const PROVIDER_KINDS = ["gitea", "forgejo", "github"];
export const AUTH_TYPES = ["token", "basic", "ssh", "none"];

/** DSH credential reference grammar. */
const REF_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Stable credential-ref suffix derived from a provider name. */
export function refSuffixOf(name) {
  const s = String(name || "provider").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "PROVIDER";
}

export const defaultTokenRef = (name) => "DSH_GIT_CONNECTOR_" + refSuffixOf(name) + "_TOKEN";
export const defaultPasswordRef = (name) => "DSH_GIT_CONNECTOR_" + refSuffixOf(name) + "_PASSWORD";

function assertRefName(ref, field) {
  if (ref === undefined || ref === null || ref === "") return;
  if (!REF_NAME_RE.test(ref)) {
    throw new Error(
      field + " " + JSON.stringify(ref) + " is not a valid credential reference - use only letters, digits and " +
      "underscores, starting with a letter or underscore (e.g. DSH_GIT_CONNECTOR_MY_GITEA_TOKEN)"
    );
  }
}

function trim(value, fallback = "") {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? fallback : String(value).trim();
}

function stripSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

/**
 * First value that is neither undefined, null nor an empty string.
 * Tool callers routinely pass "" for fields they did not set, and ?? alone
 * would let that empty string shadow a real value from the existing record.
 */
function firstSet(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return undefined;
}

/**
 * Default API + git base URLs per forge kind.
 * Gitea serves both from one origin; GitHub splits them across two hosts, and
 * GitHub Enterprise inserts /api/v3 on the API side.
 */
export function defaultBaseUrls(kind, baseUrl) {
  const base = stripSlash(baseUrl);
  if (kind === "github") {
    if (base === "") return { apiBaseUrl: "https://api.github.com", gitBaseUrl: "https://github.com" };
    return { apiBaseUrl: base + "/api/v3", gitBaseUrl: base };
  }
  const one = base === "" ? "https://gitea.com" : base;
  return { apiBaseUrl: one, gitBaseUrl: one };
}

/** Normalise + validate one provider record. */
export function sanitizeProvider(input = {}, existing = null) {
  const base = existing ?? {};
  const name = trim(firstSet(input.name, base.name));
  if (!name) throw new Error("provider name is required");
  const kind = trim(firstSet(input.kind, base.kind, "gitea")).toLowerCase();
  if (!PROVIDER_KINDS.includes(kind)) {
    throw new Error("provider kind must be one of " + PROVIDER_KINDS.join("|") + ", got " + JSON.stringify(kind));
  }
  const rawBase = trim(firstSet(input.baseUrl, input.gitBaseUrl, base.gitBaseUrl, base.apiBaseUrl) ?? "");
  const derived = defaultBaseUrls(kind, rawBase);
  const apiBaseUrl = stripSlash(trim(firstSet(input.apiBaseUrl, base.apiBaseUrl, derived.apiBaseUrl)));
  const gitBaseUrl = stripSlash(trim(firstSet(input.gitBaseUrl, base.gitBaseUrl, derived.gitBaseUrl)));
  if (!/^https?:\/\//i.test(apiBaseUrl)) throw new Error("provider apiBaseUrl must be an http(s) URL, got " + JSON.stringify(apiBaseUrl));
  if (!/^https?:\/\//i.test(gitBaseUrl)) throw new Error("provider gitBaseUrl must be an http(s) URL, got " + JSON.stringify(gitBaseUrl));

  const authType = trim(firstSet(input.authType, base.authType, "token")).toLowerCase();
  if (!AUTH_TYPES.includes(authType)) {
    throw new Error("provider authType must be one of " + AUTH_TYPES.join("|") + ", got " + JSON.stringify(authType));
  }
  const tokenRef = trim(firstSet(input.tokenRef, base.tokenRef, defaultTokenRef(name)));
  const passwordRef = trim(firstSet(input.passwordRef, base.passwordRef) ?? "");
  assertRefName(tokenRef, "tokenRef");
  assertRefName(passwordRef, "passwordRef");

  const now = new Date().toISOString();
  return {
    id: base.id ?? "prov_" + randomUUID().replace(/-/g, "").slice(0, 12),
    name,
    kind,
    apiBaseUrl,
    gitBaseUrl,
    authType,
    username: trim(firstSet(input.username, base.username) ?? ""),
    tokenRef,
    passwordRef,
    keyPath: trim(firstSet(input.keyPath, base.keyPath) ?? ""),
    caFile: trim(firstSet(input.caFile, base.caFile) ?? ""),
    allowInsecure: firstSet(input.allowInsecure, base.allowInsecure) === true,
    defaultBranch: trim(firstSet(input.defaultBranch, base.defaultBranch, "main")) || "main",
    created: base.created ?? now,
    updated: now,
  };
}

/** Public (secret-free) projection of a provider. */
export function publicProvider(p) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    apiBaseUrl: p.apiBaseUrl,
    gitBaseUrl: p.gitBaseUrl,
    authType: p.authType,
    username: p.username,
    tokenRef: p.tokenRef,
    passwordRef: p.passwordRef,
    keyPath: p.keyPath,
    caFile: p.caFile,
    allowInsecure: p.allowInsecure,
    defaultBranch: p.defaultBranch,
    created: p.created,
    updated: p.updated,
  };
}

/** Compact, display-oriented summary of a repo's flags. */
function flagSummary(repo, provider, cfg) {
  const { effective, sources } = resolveFlags(repo, provider, cfg);
  const on = [];
  for (const key of Object.keys(effective)) {
    const value = effective[key];
    if (value === true) on.push(key + (sources[key] === "repo" ? "" : "(" + sources[key] + ")"));
  }
  return on;
}

/** Normalise + validate one repo profile. Needs the provider table for ref resolution. */
export function sanitizeRepo(input = {}, existing = null, context = {}) {
  const { cfg = {}, providers = [] } = context;
  const base = existing ?? {};
  const name = trim(firstSet(input.name, base.name));
  if (!name) throw new Error("repo name is required");

  const providerRef = trim(firstSet(input.providerRef, input.provider, base.providerRef) ?? "");
  let provider = null;
  if (providerRef) {
    provider = providers.find((p) => p.id === providerRef || p.name === providerRef);
    if (!provider) {
      throw new Error(
        "provider " + JSON.stringify(providerRef) + " not found - known providers: " +
        (providers.map((p) => p.name).join(", ") || "(none saved yet)")
      );
    }
  }
  if (!provider && !cfg.allowRawUrl) {
    throw new Error(
      "repo needs a providerRef (set allowRawUrl=true in the plugin config to connect a bare URL instead)"
    );
  }

  const owner = trim(firstSet(input.owner, base.owner) ?? "");
  const repoName = trim(firstSet(input.repo, base.repo) ?? "");
  if (provider && (!owner || !repoName)) {
    throw new Error("repo needs owner and repo (e.g. owner=\"sycada\", repo=\"dsh-git-connector\")");
  }

  let remoteUrl = trim(firstSet(input.remoteUrl, base.remoteUrl) ?? "");
  if (provider && owner && repoName) {
    remoteUrl = provider.gitBaseUrl + "/" + owner + "/" + repoName + ".git";
  }
  if (!remoteUrl) throw new Error("repo needs a remoteUrl (or owner+repo with a provider)");
  if (!cfg.allowRawUrl && !provider) throw new Error("a bare remoteUrl requires allowRawUrl=true");

  const flags = sanitizeFlags(input.flags ?? {}, base.flags ?? {});
  const probe = { flags };
  const { effective } = resolveFlags(probe, provider ?? {}, cfg);

  let localPath = trim(firstSet(input.localPath, base.localPath) ?? "");
  if (!localPath) localPath = defaultLocalPath(owner || "repo", repoName || name, cfg);
  localPath = assertLocalPath(localPath, cfg, effective.allowOutsideWorkspace === true);

  const now = new Date().toISOString();
  return {
    id: base.id ?? "repo_" + randomUUID().replace(/-/g, "").slice(0, 12),
    name,
    providerRef: provider ? provider.name : "",
    owner,
    repo: repoName,
    remoteUrl,
    localPath,
    defaultBranch: trim(firstSet(input.defaultBranch, base.defaultBranch, effective.defaultBranchOverride, provider ? provider.defaultBranch : "", "main")) || "main",
    flags,
    created: base.created ?? now,
    updated: now,
  };
}

/** Public projection of a repo, with resolved flags folded in. */
export function publicRepo(r, provider = null, cfg = {}) {
  return {
    id: r.id,
    name: r.name,
    providerRef: r.providerRef,
    owner: r.owner,
    repo: r.repo,
    remoteUrl: r.remoteUrl,
    localPath: r.localPath,
    defaultBranch: r.defaultBranch,
    flags: r.flags ?? {},
    activeFlags: flagSummary(r, provider ?? {}, cfg),
    created: r.created,
    updated: r.updated,
  };
}

/**
 * Plugin-level settings the Settings card owns.
 * gitPath lives here rather than in the profile config so the card can change it
 * at runtime; the profile config remains the deployment default (and wins only
 * when the card has not set anything).
 */
export const DEFAULT_SETTINGS = { gitPath: "" };

function sanitizeSettings(input = {}, base = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(base ?? {}) };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (key !== "gitPath") continue;
    merged.gitPath = typeof value === "string" ? value.trim() : "";
  }
  return merged;
}

/** Load the store, tolerating a missing or corrupt file. */
export function readStore() {
  const { file } = storePaths();
  const seed = { version: STORE_VERSION, providers: [], repos: [], settings: { ...DEFAULT_SETTINGS }, created: new Date().toISOString() };
  try {
    if (!existsSync(file)) return seed;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return seed;
    return {
      version: STORE_VERSION,
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      repos: Array.isArray(parsed.repos) ? parsed.repos : [],
      settings: sanitizeSettings(parsed.settings ?? {}, {}),
      created: parsed.created ?? seed.created,
    };
  } catch {
    return seed;
  }
}

/** Persist atomically (temp file + rename). Never writes secrets. */
export function writeStore(store) {
  const { dir, file } = storePaths();
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, ".store." + process.pid + "." + Date.now() + ".tmp");
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  try { mkdirSync(dir, { mode: 0o700 }); } catch { /* best effort on Windows */ }
}

/** Create the store service: in-memory snapshot + persistence + CRUD. */
export function createStore(cfg = {}) {
  const snapshot = readStore();
  const listeners = [];
  const emit = () => { for (const l of listeners) { try { l(); } catch { /* ignore */ } } };

  const api = {
    snapshot,
    cfg,
    save() { writeStore(snapshot); return api; },

    /** Plugin-level settings (currently just gitPath). */
    getSettings() { return { ...DEFAULT_SETTINGS, ...(snapshot.settings ?? {}) }; },
    updateSettings(patch) {
      snapshot.settings = sanitizeSettings(patch, snapshot.settings ?? {});
      api.save();
      emit();
      return api.getSettings();
    },

    listProviders() { return snapshot.providers.map(publicProvider); },
    rawProviders() { return snapshot.providers; },
    findProvider(idOrName) {
      const key = String(idOrName ?? "");
      return snapshot.providers.find((p) => p.id === key || p.name === key);
    },
    providerOf(repo) {
      return repo && repo.providerRef ? api.findProvider(repo.providerRef) ?? null : null;
    },
    upsertProvider(input, id) {
      const existing = id ? api.findProvider(id) : undefined;
      if (id && !existing) throw new Error("provider \"" + id + "\" not found");
      const record = sanitizeProvider(input, existing);
      if (!existing && api.findProvider(record.name)) {
        throw new Error("a provider named \"" + record.name + "\" already exists");
      }
      if (existing) {
        const idx = snapshot.providers.findIndex((p) => p.id === existing.id);
        snapshot.providers[idx] = record;
      } else {
        snapshot.providers.push(record);
      }
      api.save();
      emit();
      return publicProvider(record);
    },
    removeProvider(idOrName) {
      const found = api.findProvider(idOrName);
      if (!found) throw new Error("provider \"" + idOrName + "\" not found");
      const inUse = snapshot.repos.filter((r) => r.providerRef === found.name);
      if (inUse.length > 0) {
        throw new Error(
          "provider \"" + found.name + "\" is still used by " + inUse.length + " repo profile(s): " +
          inUse.map((r) => r.name).join(", ")
        );
      }
      snapshot.providers.splice(snapshot.providers.indexOf(found), 1);
      api.save();
      emit();
      return publicProvider(found);
    },

    listRepos() {
      return snapshot.repos.map((r) => publicRepo(r, api.providerOf(r), cfg));
    },
    rawRepos() { return snapshot.repos; },
    /** Resolve by id, by profile name, or by <provider>/<owner>/<repo>. */
    findRepo(idOrName) {
      const key = String(idOrName ?? "").trim();
      if (!key) return undefined;
      const direct = snapshot.repos.find((r) => r.id === key || r.name === key);
      if (direct) return direct;
      const parts = key.split("/").filter(Boolean);
      if (parts.length === 3) {
        const [p, o, rp] = parts;
        return snapshot.repos.find((r) => r.providerRef === p && r.owner === o && r.repo === rp);
      }
      if (parts.length === 2) {
        const [o, rp] = parts;
        return snapshot.repos.find((r) => r.owner === o && r.repo === rp);
      }
      return undefined;
    },
    /** Candidate names for a failed lookup, so the agent can self-correct. */
    repoNames() { return snapshot.repos.map((r) => r.name); },
    upsertRepo(input, id) {
      const existing = id ? api.findRepo(id) : undefined;
      if (id && !existing) throw new Error("repo \"" + id + "\" not found");
      const record = sanitizeRepo(input, existing, { cfg, providers: snapshot.providers });
      if (!existing && api.findRepo(record.name)) {
        throw new Error("a repo profile named \"" + record.name + "\" already exists");
      }
      if (existing) {
        const idx = snapshot.repos.findIndex((r) => r.id === existing.id);
        snapshot.repos[idx] = record;
      } else {
        snapshot.repos.push(record);
      }
      api.save();
      emit();
      return publicRepo(record, api.providerOf(record), cfg);
    },
    removeRepo(idOrName) {
      const found = api.findRepo(idOrName);
      if (!found) throw new Error("repo \"" + idOrName + "\" not found");
      snapshot.repos.splice(snapshot.repos.indexOf(found), 1);
      api.save();
      emit();
      return publicRepo(found, api.providerOf(found), cfg);
    },

    on(listener) {
      listeners.push(listener);
      return () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); };
    },
  };
  return api;
}
