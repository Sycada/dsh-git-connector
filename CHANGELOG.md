# Changelog

## 0.1.0

Initial release.

### Added

- Saved forge providers: `git_provider_list` / `_add` / `_update` / `_remove` / `_test`.
  Gitea, Forgejo and GitHub kinds, with per-kind API/git base URL derivation
  (GitHub splits `api.github.com` from `github.com`; GitHub Enterprise inserts `/api/v3`).
- Saved repo profiles addressed by name: `git_repo_list` / `_add` / `_update` / `_remove`.
  Remote URLs are derived from the provider's git base URL plus owner/repo.
- Git work-copy operations: `git_clone` `git_fetch` `git_pull` `git_push` `git_status`
  `git_branch` `git_diff` `git_log` `git_commit`.
- Forge REST tools: `forge_repo_list` `forge_repo_create` `forge_repo_info` `forge_branch_list`
  `forge_contents` `forge_pull_list` `forge_pull_create` `forge_issue_create`.
- `git_credential_status` reports which reference backs each provider without revealing values.
- Per-repo safety flags with a single arbitration point (`lib/flags.js`): `insecureTls`, `caFile`,
  `allowForcePush`, `allowOutsideWorkspace`, `overwriteRemote`, `overwriteLocal`,
  `allowForceDefaultBranch`, `readOnly`, `fetchPrune`, `commitIdentity`,
  `defaultBranchOverride`.
- Ephemeral `GIT_ASKPASS` credential injection: secrets travel via the environment, never argv,
  never the remote URL, never the work copy's `.git/config`.
- Per-request TLS control built on `node:https` (no global TLS state is ever mutated).
- Settings card (Settings > Plugins > Git Connector and its own Settings section) for providers,
  keys and per-repo flags, with clone/pull/status/test actions.
- System-prompt section announcing the capability and listing saved profiles.

### Safety

- `allowRawUrl` off by default (no arbitrary URL connect without a provider).
- `localPath` fenced to `workspaceRoot` unless the profile opts out.
- Force push requires four independent gates plus a non-default branch.
- Every overwrite-enabled destructive operation returns a rollback reference.
- Browser fence on the settings API (loopback or `trustedHosts`).

### Tests

- `dev-assets/smoke-test.cjs`: 40 structural assertions.
- `dev-assets/behavior-test.cjs`: 34 end-to-end assertions against a local authenticated git remote.
