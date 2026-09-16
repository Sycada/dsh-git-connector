# dsh-git-connector

> A **Git repository connector** for DeepSeek Harness: save Gitea / Forgejo / GitHub providers and
> repo profiles, let the agent reach a repository **by profile name**, and authorise dangerous
> behaviours (**skip TLS verification, allow overwrites**) **per repository**.

Keys live in the **DSH credential center** (`~/.dsh/.credentials.yaml`); plugin data holds only the
reference name - never the secret itself.

## Relationship to the community plugin

This plugin focuses on **git transport + forge APIs** and targets **Gitea / Forgejo / self-hosted**
instances, with GitHub support as well. The community `dsh-github-connector` focuses on GitHub
pull-request review and merge flows. They are **complementary and can coexist**.

## Install

Add the dependency to your DSH profile and register the bundle:

```jsonc
"dependencies": {
  "dsh-git-connector": "https://github.com/Sycada/dsh-git-connector.git#main"
},
"dsh": {
  "profile": {
    "bundles": [ ..., "dsh-git-connector" ]
  }
}
```

The plugin has **no runtime dependencies**: git is invoked as a subprocess and HTTP uses Node's
built-in `node:https`.

## Quick start

### 1. Add a provider

`@
git_provider_add { name: "my-gitea", kind: "gitea", baseUrl: "https://git.example.com", username: "alice" }
`@

The credential reference `DSH_GIT_CONNECTOR_MY_GITEA_TOKEN` is derived automatically.

### 2. Store the key

Open **Settings -> Plugins -> Git Connector**, paste the token on the provider row and press
**Save key**. You may also write `~/.dsh/.credentials.yaml` directly or use an environment
variable of the same name.

Verify with:

`@
git_provider_test { provider: "my-gitea" }
`@

### 3. Add a repo profile

`@
git_repo_add { name: "my-project", providerRef: "my-gitea", owner: "alice", repo: "my-project" }
`@

The remote URL is **derived** from `gitBaseUrl + owner/repo`.

### 4. Work by profile name

`@
git_clone  { repo: "my-project" }
git_status { repo: "my-project" }
git_commit { repo: "my-project", message: "feat: ..." }
git_push   { repo: "my-project" }
`@

Every later operation uses the **profile name only** - the agent never needs the URL, the
credentials or the local path.

## Tools

| Group | Tools |
|---|---|
| Providers | `git_provider_list` `git_provider_add` `git_provider_update` `git_provider_remove` `git_provider_test` |
| Repo profiles | `git_repo_list` `git_repo_add` `git_repo_update` `git_repo_remove` |
| Git operations | `git_clone` `git_fetch` `git_pull` `git_push` `git_status` `git_branch` `git_diff` `git_log` `git_commit` |
| Forge API | `forge_repo_list` `forge_repo_create` `forge_repo_info` `forge_branch_list` `forge_contents` `forge_pull_list` `forge_pull_create` `forge_issue_create` |
| Credentials | `git_credential_status` |

Profile management and execution are kept strictly apart: `git_repo_*` only maintains profiles,
`git_*` acts on a repository.

## Per-repo flags

Effective value = `repo.flags[key]` -> provider field -> **global config** -> **built-in default**.

| Flag | Default | Effect |
|---|---|---|
| `insecureTls` | inherits provider/global (**false**) | **Skip certificate verification** (escape hatch for self-signed hosts; prefer `caFile`) |
| `caFile` | inherits provider | Verify with a PEM file (safer than `insecureTls`) |
| `overwriteLocal` | **false** (repo-only) | **Destroy local work-copy state**: clone into a non-empty directory (backup first), pull discarding changes (stash first), delete an unmerged branch (SHA recorded) |
| `overwriteRemote` | **false** (repo-only) | **Rewrite remote history** (force push) |
| `allowForcePush` | inherits global (**false**) | First gate for force push |
| `allowForceDefaultBranch` | **false** (repo-only) | Permit force-pushing the default branch |
| `allowOutsideWorkspace` | inherits global (**false**) | Permit `localPath` outside the workspace root |
| `readOnly` | **false** (repo-only) | Reject every write operation |
| `fetchPrune` | true | Pass `--prune` to fetch |
| `commitIdentity` | inherits global `instanceLabel` | Commit author tag |

### The overwrite rule

With `overwriteLocal` enabled, **every destructive operation returns something you can roll back
to** (a backup directory path, `stash@{0}`, a deleted branch SHA, a previous remote SHA). There is
no path where flipping a switch silently loses data.

A force push requires **four gates open at once**:

`@
global.allowForcePush  AND  repo.flags.allowForcePush  AND
repo.flags.overwriteRemote  AND  the call passes confirmForce: true
(and the target must not be the default branch unless allowForceDefaultBranch is on)
`@

## Security

| Concern | Approach |
|---|---|
| Key storage | Only the **reference name** is stored; the value lives in the DSH credential center |
| Key injection | A throwaway `GIT_ASKPASS` helper per operation; the value travels via the **environment** - not argv, not the URL, never on disk; removed when the command ends and swept on startup after a crash |
| Subprocess discipline | Only `spawn(git, argv[])` - never a shell string |
| Credential helper | `credential.helper` is reset per call, so the system credential manager never sees or caches the token |
| TLS | Verified by default; `insecureTls` builds a one-request agent and never mutates process-wide TLS state |
| SSRF | `allowRawUrl` is off: without a provider you cannot connect an arbitrary URL |
| Path fence | `localPath` must stay inside `workspaceRoot` unless the profile opts out |
| Browser fence | The settings API is reachable from loopback (or `trustedHosts`) only |
| Commit identity | Commits are authored as `dsh-git-connector[<instanceLabel>]`, distinguishable from the user's and other agents' |

## Configuration

```yaml
gitPath: ""                  # custom git binary; empty = auto-detect
gitTimeoutMs: 300000         # per-command timeout
gitOutputLimit: 1048576      # stdout/stderr cap in bytes
workspaceRoot: ""            # work-copy root; empty = ~/.dsh/dsh-git-connector/workspaces
allowOutsideWorkspace: false
allowForcePush: false
allowRawUrl: false
allowInsecure: false
httpTimeoutMs: 30000
maxOutputLines: 2000
promptSectionOrder: 570
instanceLabel: ""            # commit tag, e.g. "desktop-1"
trustedHosts: []
```

## License

MIT
