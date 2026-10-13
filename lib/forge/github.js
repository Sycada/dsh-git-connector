/**
 * dsh-git-connector - GitHub adapter (REST).
 *
 * Unlike Gitea, GitHub splits its API host from its git host
 * (api.github.com vs github.com), and GitHub Enterprise inserts /api/v3.
 * defaultBaseUrls() in store.js already encodes that, so this adapter only
 * has to speak the protocol.
 */
import { forgeRequest, unwrap, normalizeRepo, normalizeBranch, normalizePull, normalizeContent, normalizeTag } from "./index.js";

/** GET /meta - unauthenticated server metadata. */
async function version(ctx) {
  const res = await forgeRequest(ctx.provider, { path: "/meta", auth: false, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "github meta");
  return { version: String(data?.installed_version ?? data?.verifiable_password_authentication ?? "github"), raw: data };
}

/** GET /user */
async function whoami(ctx) {
  const res = await forgeRequest(ctx.provider, { path: "/user", token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "github whoami");
  return { login: String(data?.login ?? ""), name: String(data?.name ?? ""), admin: false };
}

/** GET /user/repos */
async function listRepos(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/user/repos",
    query: { per_page: ctx.limit ?? 50, page: ctx.page ?? 1, sort: "updated" },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github list repos");
  return Array.isArray(data) ? data.map(normalizeRepo) : [];
}

/** POST /user/repos */
async function createRepo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/user/repos",
    method: "POST",
    body: {
      name: ctx.name,
      private: ctx.private === true,
      auto_init: ctx.autoInit === true,
      description: ctx.description || undefined,
    },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "github create repo"));
}

/** GET /repos/{owner}/{repo} */
async function repoInfo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo),
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "github repo info"));
}

/** GET /repos/{owner}/{repo}/branches */
async function listBranches(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/branches",
    query: { per_page: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github list branches");
  return Array.isArray(data) ? data.map(normalizeBranch) : [];
}

/** GET /repos/{owner}/{repo}/contents/{path} */
async function getContents(ctx) {
  let path = "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/contents";
  if (ctx.path) {
    const clean = String(ctx.path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
    path += "/" + clean;
  }
  const res = await forgeRequest(ctx.provider, {
    path, query: { ref: ctx.ref || undefined }, token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeContent(unwrap(res, "github contents"));
}

/** GET /repos/{owner}/{repo}/pulls */
async function listPulls(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    query: { state: ctx.state || "open", per_page: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github list pulls");
  return Array.isArray(data) ? data.map(normalizePull) : [];
}

/** POST /repos/{owner}/{repo}/pulls */
async function createPull(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    method: "POST",
    body: { title: ctx.title, head: ctx.head, base: ctx.base, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizePull(unwrap(res, "github create pull"));
}

/** POST /repos/{owner}/{repo}/issues */
async function createIssue(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/issues",
    method: "POST",
    body: { title: ctx.title, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github create issue");
  return { number: Number(data?.number ?? 0), title: String(data?.title ?? ""), htmlUrl: String(data?.html_url ?? "") };
}

/** POST /repos/{owner}/{repo}/git/refs - GitHub branches ARE refs. */
async function createBranch(ctx) {
  const from = String(ctx.from || "").trim();
  let sha = from;
  if (sha === "") {
    const info = await forgeRequest(ctx.provider, {
      path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo),
      token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
    });
    sha = String(unwrap(info, "github repo info")?.default_branch ?? "");
  }
  const resolved = await resolveSha(ctx, sha);
  if (!resolved) throw new Error("github create branch: could not resolve start point " + JSON.stringify(from || sha) + " to a commit");
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/git/refs",
    method: "POST",
    body: { ref: "refs/heads/" + ctx.name, sha: resolved },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github create branch");
  return { name: String(ctx.name), sha: String(data?.object?.sha ?? resolved) };
}

/** DELETE /repos/{owner}/{repo}/git/refs/heads/{name} */
async function deleteBranch(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/git/refs/heads/" + encodeURIComponent(ctx.name),
    method: "DELETE",
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  unwrap(res, "github delete branch");
  return { name: String(ctx.name), deleted: true };
}

/**
 * Resolve a branch, tag or commit-ish to a commit sha.
 *
 * GitHub's tag creation is commit-addressed, and a tag target is often a branch
 * name ("main") rather than a sha, so the ref has to be dereferenced first.
 * A sha passes through untouched.
 */
async function resolveSha(ctx, ref) {
  const value = String(ref || "").trim();
  if (value === "" || /^[0-9a-f]{7,40}$/i.test(value)) return value;
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/commits/" + encodeURIComponent(value),
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github resolve ref " + JSON.stringify(value));
  return String(data?.sha ?? "");
}

/** GET /repos/{owner}/{repo}/git/refs/tags - refs are returned, not tag objects. */
async function listTags(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/git/refs/tags",
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github list tags");
  const refs = Array.isArray(data) ? data : [];
  // A ref list carries no annotation text, so fetch each tag object only when a
  // message actually matters; the sha is enough for the list view.
  return refs.slice(0, ctx.limit ?? 50).map(normalizeTag);
}

/**
 * Create a tag in two requests, because GitHub splits what Gitea does in one:
 *   1. POST /git/tags  - create the tag OBJECT (optionally annotated),
 *   2. POST /git/refs  - create refs/tags/<name> pointing at that object.
 *
 * A lightweight tag is the degenerate case: the ref points straight at the
 * commit and no tag object is created at all.
 */
async function createTag(ctx) {
  const sha = await resolveSha(ctx, ctx.target || ctx.branch || "");
  if (!sha) throw new Error("github create tag: could not resolve target " + JSON.stringify(String(ctx.target || ctx.branch || "")) + " to a commit");

  const annotated = ctx.annotated === true || Boolean(ctx.message);
  let objectSha = sha;
  if (annotated) {
    const created = await forgeRequest(ctx.provider, {
      path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/git/tags",
      method: "POST",
      body: { tag: ctx.tag, message: ctx.message || ctx.tag, object: sha, type: "commit" },
      token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
    });
    objectSha = String(unwrap(created, "github create tag object")?.sha ?? "");
  }

  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/git/refs",
    method: "POST",
    body: { ref: "refs/tags/" + ctx.tag, sha: objectSha },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github create tag ref");
  return {
    tag: { ...normalizeTag(data), name: String(ctx.tag), sha },
    annotated,
    release: false,
  };
}

export default {
  kind: "github",
  label: "GitHub",
  apiPrefix: "",
  probePaths: ["/meta", "/user", "/rate_limit"],
  version, whoami, listRepos, createRepo, repoInfo, listBranches, getContents, listPulls, createPull, createIssue,
  listTags, createTag, createBranch, deleteBranch,
};
