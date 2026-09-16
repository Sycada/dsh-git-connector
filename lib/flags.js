/**
 * dsh-git-connector - per-repo safety flags: the SINGLE arbitration point.
 *
 * Every flag resolves as  repo.flags[key]  ->  provider field  ->  global cfg  ->  built-in default.
 * The Settings card and the agent tools both call resolveFlags(), so what the UI
 * shows and what execution enforces can never drift apart.
 *
 * Most flags inherit a global value. Three are deliberately repo-only:
 * overwriteRemote / overwriteLocal / allowForceDefaultBranch are the destructive
 * opt-ins, and a global "yes" for those would be a footgun.
 */

/** The complete flag vocabulary. */
export const FLAG_DEFS = {
  insecureTls: {
    type: "boolean", def: false, fromProvider: "allowInsecure", dangerous: true,
    description: "Skip TLS certificate verification for this repo (self-signed / private-CA instances).",
  },
  caFile: {
    type: "string", def: "", fromProvider: "caFile",
    description: "PEM file used to verify this repo's server certificate (safer than insecureTls).",
  },
  defaultBranchOverride: {
    type: "string", def: "", fromProvider: "defaultBranch",
    description: "Branch treated as this repo's default, overriding the provider value.",
  },
  allowForcePush: {
    type: "boolean", def: false, fromConfig: "allowForcePush", dangerous: true,
    description: "First gate for force pushes on this repo (global default is off).",
  },
  allowOutsideWorkspace: {
    type: "boolean", def: false, fromConfig: "allowOutsideWorkspace",
    description: "Permit this repo's localPath to sit outside the workspace root.",
  },
  allowForceDefaultBranch: {
    type: "boolean", def: false, repoOnly: true, dangerous: true,
    description: "Permit force-pushing this repo's default branch (otherwise refused).",
  },
  overwriteRemote: {
    type: "boolean", def: false, repoOnly: true, dangerous: true,
    description: "Permit rewriting remote history for this repo (force push). Repo-only: no global switch.",
  },
  overwriteLocal: {
    type: "boolean", def: false, repoOnly: true, dangerous: true,
    description: "Permit destroying local work-copy state (non-empty clone target, discarded local changes, unmerged branch delete). Repo-only: no global switch.",
  },
  readOnly: {
    type: "boolean", def: false, repoOnly: true,
    description: "Reject every write operation on this repo (push, commit, branch delete, pull that lands changes).",
  },
  fetchPrune: {
    type: "boolean", def: true, fromConfig: "fetchPrune",
    description: "Pass --prune to fetch.",
  },
  commitIdentity: {
    type: "string", def: "", fromConfig: "instanceLabel",
    description: "Author tag used for commits this plugin creates in this repo.",
  },
};

/** Every known flag name. */
export const FLAG_NAMES = Object.keys(FLAG_DEFS);

function coerce(def, raw) {
  if (def.type === "boolean") return raw === true;
  return String(raw);
}

function present(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Resolve every flag for one repo.
 * @returns {{effective: Record<string, unknown>, sources: Record<string, string>}}
 *   sources values are "repo" | "provider" | "global" | "default".
 */
export function resolveFlags(repo = {}, provider = {}, cfg = {}) {
  const own = repo && typeof repo.flags === "object" && repo.flags ? repo.flags : {};
  const effective = {};
  const sources = {};
  for (const [key, def] of Object.entries(FLAG_DEFS)) {
    if (own[key] !== undefined && own[key] !== null) {
      effective[key] = coerce(def, own[key]);
      sources[key] = "repo";
      continue;
    }
    const pv = def.fromProvider ? provider?.[def.fromProvider] : undefined;
    if (def.fromProvider && present(pv)) {
      effective[key] = coerce(def, pv);
      sources[key] = "provider";
      continue;
    }
    const gv = def.fromConfig ? cfg?.[def.fromConfig] : undefined;
    if (def.fromConfig && present(gv)) {
      effective[key] = coerce(def, gv);
      sources[key] = "global";
      continue;
    }
    effective[key] = def.def;
    sources[key] = "default";
  }
  return { effective, sources };
}

/** Convenience: one resolved flag. */
export function flagOf(repo, provider, cfg, key) {
  return resolveFlags(repo, provider, cfg).effective[key];
}

/** Redacted, UI/tool-facing view: value plus where it came from. */
export function publicFlags(repo, provider, cfg) {
  const { effective, sources } = resolveFlags(repo, provider, cfg);
  return FLAG_NAMES.map((key) => ({
    key,
    value: effective[key],
    source: sources[key],
    overridden: sources[key] === "repo",
    dangerous: FLAG_DEFS[key].dangerous === true,
    repoOnly: FLAG_DEFS[key].repoOnly === true,
    description: FLAG_DEFS[key].description,
  }));
}

/** Validate an incoming flags patch from a tool or the settings card. */
export function sanitizeFlags(input = {}, base = {}) {
  const out = { ...(base && typeof base === "object" ? base : {}) };
  for (const [key, value] of Object.entries(input || {})) {
    const def = FLAG_DEFS[key];
    if (!def) throw new Error("unknown repo flag " + JSON.stringify(key) + " - known flags: " + FLAG_NAMES.join(", "));
    if (value === null) { delete out[key]; continue; }
    if (def.type === "boolean") {
      if (typeof value !== "boolean") throw new Error("flag " + key + " must be a boolean, got " + JSON.stringify(value));
      out[key] = value;
      continue;
    }
    if (typeof value !== "string") throw new Error("flag " + key + " must be a string, got " + JSON.stringify(value));
    const trimmed = value.trim();
    if (trimmed === "") delete out[key];
    else out[key] = trimmed;
  }
  return out;
}
