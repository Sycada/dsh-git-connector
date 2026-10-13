/**
 * dsh-git-connector - Gitea / Forgejo adapter (REST v1).
 *
 * Gitea serves its git transport and its API from the SAME origin, so
 * gitBaseUrl === apiBaseUrl; only the /api/v1 prefix differs.
 */
import { forgeRequest, unwrap, normalizeRepo, normalizeBranch, normalizePull, normalizeContent, normalizeTag } from "./index.js";

const PREFIX = "/api/v1";

/** GET /api/v1/version - the one unauthenticated capability probe. */
async function version(ctx) {
  const res = await forgeRequest(ctx.provider, { path: PREFIX + "/version", auth: false, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "gitea version");
  return { version: String(data?.version ?? ""), raw: data };
}

/** GET /api/v1/user - proves the token works. */
async function whoami(ctx) {
  const res = await forgeRequest(ctx.provider, { path: PREFIX + "/user", token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "gitea whoami");
  return { login: String(data?.login ?? ""), name: String(data?.full_name ?? ""), admin: data?.is_admin === true };
}

/** GET /api/v1/user/repos */
async function listRepos(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/user/repos",
    query: { limit: ctx.limit ?? 50, page: ctx.page ?? 1 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea list repos");
  return Array.isArray(data) ? data.map(normalizeRepo) : [];
}

/** POST /api/v1/user/repos */
async function createRepo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/user/repos",
    method: "POST",
    body: {
      name: ctx.name,
      private: ctx.private === true,
      auto_init: ctx.autoInit === true,
      default_branch: ctx.defaultBranch || undefined,
      description: ctx.description || undefined,
    },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "gitea create repo"));
}

/** GET /api/v1/repos/{owner}/{repo} */
async function repoInfo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo),
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "gitea repo info"));
}

/** GET /api/v1/repos/{owner}/{repo}/branches */
async function listBranches(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/branches",
    query: { limit: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea list branches");
  return Array.isArray(data) ? data.map(normalizeBranch) : [];
}

/** GET /api/v1/repos/{owner}/{repo}/contents/{path} */
async function getContents(ctx) {
  let path = PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/contents";
  if (ctx.path) {
    const clean = String(ctx.path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
    path += "/" + clean;
  }
  const res = await forgeRequest(ctx.provider, {
    path, query: { ref: ctx.ref || undefined }, token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeContent(unwrap(res, "gitea contents"));
}

/** GET /api/v1/repos/{owner}/{repo}/pulls */
async function listPulls(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    query: { state: ctx.state || "open", limit: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea list pulls");
  return Array.isArray(data) ? data.map(normalizePull) : [];
}

/** POST /api/v1/repos/{owner}/{repo}/pulls */
async function createPull(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    method: "POST",
    body: { title: ctx.title, head: ctx.head, base: ctx.base, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizePull(unwrap(res, "gitea create pull"));
}

/** POST /api/v1/repos/{owner}/{repo}/issues */
async function createIssue(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/issues",
    method: "POST",
    body: { title: ctx.title, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea create issue");
  return { number: Number(data?.number ?? 0), title: String(data?.title ?? ""), htmlUrl: String(data?.html_url ?? "") };
}

/** POST /api/v1/repos/{owner}/{repo}/branches */
async function createBranch(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/branches",
    method: "POST",
    body: { new_branch_name: ctx.name, old_branch_name: ctx.from || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeBranch(unwrap(res, "gitea create branch"));
}

/** DELETE /api/v1/repos/{owner}/{repo}/branches/{name} */
async function deleteBranch(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/branches/" + encodeURIComponent(ctx.name),
    method: "DELETE",
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  unwrap(res, "gitea delete branch");
  return { name: String(ctx.name), deleted: true };
}

/** GET /api/v1/repos/{owner}/{repo}/tags */
async function listTags(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/tags",
    query: { limit: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea list tags");
  return Array.isArray(data) ? data.map(normalizeTag) : [];
}

/**
 * POST /api/v1/repos/{owner}/{repo}/tags
 *
 * Gitea creates the tag server-side in one call, from either a commit sha or a
 * branch name. This is the supported path: pushing refs/tags over the git
 * transport authenticates differently and fails on this instance.
 *
 * A Release is a SEPARATE request. /tags accepts only Gitea's CreateTagOption
 * (tag_name, target, message) - a nested "release" object is not part of that
 * schema, so the server drops it silently and still answers 200. Reporting
 * release: true off the request we sent was therefore a false positive: it
 * claimed a Release that was never created. Verified against Gitea 1.27.0 via
 * its own /swagger.v1.json, whose CreateTagOption carries exactly those three
 * fields and no release.
 */
async function createTag(ctx) {
  const body = { tag_name: ctx.tag, target: ctx.target || ctx.branch || undefined };
  if (ctx.message) body.message = ctx.message;
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/tags",
    method: "POST",
    body,
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea create tag");
  const tag = normalizeTag(data);
  if (ctx.release !== true) return { tag, release: false };

  // POST /api/v1/repos/{owner}/{repo}/releases - the only endpoint that makes a
  // Release. The tag already exists, so this references it by name.
  const created = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/releases",
    method: "POST",
    body: {
      tag_name: ctx.tag,
      name: ctx.releaseName || ctx.tag,
      body: ctx.releaseBody || "",
      draft: ctx.draft === true,
      prerelease: ctx.prerelease === true,
    },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const releaseData = unwrap(created, "gitea create release");
  return {
    tag,
    release: true,
    releaseName: String(releaseData?.name ?? ctx.releaseName ?? ctx.tag),
    releaseUrl: String(releaseData?.html_url ?? ""),
  };
}

export default {
  kind: "gitea",
  label: "Gitea / Forgejo",
  apiPrefix: PREFIX,
  probePaths: [PREFIX + "/version", PREFIX + "/user", "/swagger.v1.json"],
  version, whoami, listRepos, createRepo, repoInfo, listBranches, getContents, listPulls, createPull, createIssue,
  listTags, createTag, createBranch, deleteBranch,
};
