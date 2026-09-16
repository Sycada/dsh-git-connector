/**
 * dsh-git-connector - filesystem layout and workspace fencing.
 *
 * Everything this plugin persists lives under <DSH_HOME>/dsh-git-connector/
 * (DSH_HOME defaults to ~/.dsh). Secrets never live here. Local work copies are
 * fenced to a workspace root unless a repo profile explicitly opts out.
 */
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export const PLUGIN_ID = "dsh-git-connector";

/** DSH home directory (honours DSH_HOME, else ~/.dsh). */
export function dshHomeOf() {
  const env = process.env.DSH_HOME;
  return env && env.trim() !== "" ? env : join(homedir(), ".dsh");
}

/** Plugin data directory + store file. */
export function storePaths() {
  const dir = join(dshHomeOf(), PLUGIN_ID);
  return { dir, file: join(dir, "store.json") };
}

/** Root under which local work copies are allowed by default. */
export function workspaceRootOf(cfg = {}) {
  const raw = typeof cfg.workspaceRoot === "string" ? cfg.workspaceRoot.trim() : "";
  if (raw !== "") return resolve(raw);
  return join(dshHomeOf(), PLUGIN_ID, "workspaces");
}

/** Case-folded, separator-normalised absolute path used only for comparison. */
export function normalizeForCompare(p) {
  const abs = resolve(String(p));
  if (process.platform !== "win32") return abs;
  return abs.toLowerCase().replace(/\//g, "\\");
}

/** Whether child sits inside root (or equals it). */
export function isInsideRoot(child, root) {
  const c = normalizeForCompare(child);
  const r = normalizeForCompare(root);
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.startsWith(prefix);
}

/** Default work-copy location: <workspaceRoot>/<owner>/<repo>. */
export function defaultLocalPath(owner, repo, cfg = {}) {
  const parts = [owner, repo].map((p) => String(p || "").trim()).filter(Boolean);
  const root = workspaceRootOf(cfg);
  return parts.length ? join(root, ...parts) : root;
}

/** Raised when a localPath violates the workspace fence. */
export class PathFenceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PathFenceError";
    this.code = code || "PATH_FENCED";
  }
}

/**
 * Validate one repo profile's localPath against the fence.
 * `allowed` is the already-resolved per-repo allowOutsideWorkspace flag.
 * @returns the absolute local path.
 */
export function assertLocalPath(localPath, cfg = {}, allowed = false) {
  const raw = String(localPath || "").trim();
  if (raw === "") throw new PathFenceError("localPath is required", "PATH_REQUIRED");
  const abs = resolve(raw);
  if (allowed) return abs;
  const root = workspaceRootOf(cfg);
  if (!isInsideRoot(abs, root)) {
    throw new PathFenceError(
      "localPath " + JSON.stringify(abs) + " is outside the workspace root " + JSON.stringify(root) +
      " - set the repo flag allowOutsideWorkspace (or the global allowOutsideWorkspace) to permit it",
      "PATH_OUTSIDE_WORKSPACE"
    );
  }
  return abs;
}
