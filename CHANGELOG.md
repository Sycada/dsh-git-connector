# Changelog

## 0.1.8

### Fixed

- **The README advertised a DSH version this plugin cannot run on.** Both `README.md` and
  `README.en.md` listed `>= 0.1.1-rc.1` under Prerequisites, but the manifest has required
  `dsh.engines.dsh: ">=0.2.0-rc.1 <0.3.0-0"` since v0.1.3. The gap was one major range: on a
  0.1.x runtime the loader evaluates `engines.dsh` and files the plugin under `skippedBundles`,
  so it never loads at all. A reader following the README on such a host would see nothing and
  no error. The prerequisite row now states the same range the manifest enforces.

## 0.1.7

### Fixed

- **`git_status` returned "invalid output" instead of git's own explanation.** The failure
  branch in `lib/engine.js` forwards the raw `stdout`/`stderr` so a caller can see what git
  actually said, but the tool's output schema in `lib/tools.js` never declared those two keys
  and the root object is `additionalProperties: false`. The registry validator therefore
  rejected the **whole** result, and on a repo that was never cloned (or any non-git work copy)
  the model saw `tool "git_status" returned invalid output` with the real cause discarded.
  Both keys are now declared. Verified by replaying the failure branch through the runtime's
  own validator, extracted from the shipping `app.asar`: before the fix it reported
  `"value.stdout" is not a declared property (additionalProperties: false)` and the same for
  `stderr`; after the fix, zero violations.
- **`GET /state` reported a hardcoded plugin version.** `lib/routes.js` answered with the
  literal `"0.1.0"`, so the card could never show the version that was actually installed.
  It now reads `version` from the package manifest at load time, falling back to an empty
  string if the manifest is unreadable so the API keeps answering.
- **Locale dictionaries were silently dropped on every host.** `lib/client.js` guarded on
  `typeof localeSvc.define === "function"`, but the host locale service exposes
  `register(ns, dicts)` and no `define`, so the guard never matched and registration was
  skipped without an error. It now calls `register()`, and passes the raw `[zh, en]` pairs
  rather than the single column already picked at load time — the old code would have
  registered the same text under both languages.

### Notes

- The locale fix changes nothing visible yet: the card's title comes from a constant and this
  is the only string pair registered. It removes a silent no-op, not a wrong label.

## 0.1.6

### Fixed

- **Gitea/Forgejo: `forge_tag_create` reported a Release it never created.** The adapter
  nested a `release` object inside the `POST /tags` body, but Gitea's `CreateTagOption`
  is `{tag_name, target, message}` — the extra key is not part of that schema, so the server
  **dropped it silently and still answered 201**, and the tool then echoed `release: true`
  back off the request it had sent rather than off anything the server did. Verified against
  Gitea 1.27.0 through its own `/swagger.v1.json`. A Release is now its own
  `POST /releases` call, the returned `release` reflects what the server actually created,
  and `releaseUrl` carries the Release link.

### Added

- `forge_tag_create` reports `releaseUrl` (Gitea/Forgejo), so a caller gets the Release
  address rather than having to guess it from the tag name.

### Notes

- The regression test for this bug was itself the reason it survived: the Gitea mock read
  `release` off the `POST /tags` body, mirroring the adapter's assumption instead of the
  server's behaviour, so a false positive sailed through a green suite. The mock now models
  the real API — `/tags` drops an unknown `release` key and a Release must go through
  `/releases` — and the assertion checks the separate call rather than the reported flag.

## 0.1.5

### Added

- **Tag support** — the one whole capability the connector was missing.
  - `git_tag` — list, create (annotated or lightweight), push, and `remote` (read origin's
    tags over the git transport) for a repo profile's work copy.
  - `git_tag_verify` — confirm origin really holds a tag after publishing it, by reading the
    remote rather than trusting the push's exit code.
  - `forge_tag_list` / `forge_tag_create` — create the tag through the forge API, which is
    the reliable path: pushing `refs/tags/...` over the git transport can fail authentication
    on some Gitea instances. `forge_tag_create` also creates a **Release** on Gitea/Forgejo.
- **Server-side branch management**: `forge_branch_create` and `forge_branch_delete`, so a
  branch can be created or removed without a local work copy. Deleting reports the tip first
  and is refused on a `readOnly` profile.
- `forge_branch_delete` and the tag tools absorb the Gitea/GitHub protocol divergence:
  Gitea creates a tag in one `POST /tags`, GitHub needs a tag object plus a ref; callers use
  the same arguments either way.

### Changed

- The system-prompt section now states the connector is the **default** path for every git and
  forge operation, and enumerates the three cases where a shell fallback is legitimate (no
  equivalent tool, a tool that already failed, or a repository with no saved profile).
  Previously it only said "you have first-class git tools", which left shell bypass unaddressed.
- Tag creation is deliberately **not** gated by the force-push flags: tags are immutable release
  markers, so demanding `overwriteRemote` for one would be meaningless. It remains subject to
  `readOnly`.

### Fixed

- `git_tag`'s result field `tags` now always means tag **records**, for every action; a push
  reports its target names under `pushedNames`. Previously the same field carried plain strings
  for `push` and objects for `list`, which a caller could not read uniformly.
- Tag names are validated with `git check-ref-format` instead of a hand-rolled pattern, which
  accepted names git rejects (e.g. `bad..name` with consecutive dots).

## 0.1.4

### Fixed

- **Activation failure when `@deepseek-ai/dsh-client-locale` is not loaded.** 0.1.3
  added `"locale"` to the client plugin's `inject` array, which makes it a HARD
  dependency. On a host that does not load the locale plugin (it is not part of
  every profile), the fiber stayed pending forever and the plugin never
  activated — taking the whole DSH startup down with `dsh-git-connector: failed`.
  `inject` is back to `["slots"]` and the locale dictionaries are now registered
  through a defensive `ctx.get("locale")` lookup, so the card still localises
  when the service is present and degrades silently when it is not.

## 0.1.3

### Fixed

- The Settings entry now registers into **`plugins.item`**, the slot the Plugins page
  actually declares in DSH 0.2.0-rc.2, instead of `settings.plugins.tab`. The former
  `settings.section` registration is removed: with `plugins.item` live it produced a
  second, duplicate "Git Connector" entry in the Settings navigation.
- The card honours the page's own chrome. The Plugins page renders the entry itself
  (title, icon, back button) and calls the component with `view="summary"` for the list
  card and `view="page"` for the detail page; neither sets `defaultOpen`, so the
  component's internal `open` flag never flipped and the detail page rendered an empty
  body. `view="page"` is now treated as permanently expanded, and rendering a collapsible
  header there no longer duplicates the page's own header.
- `peerDependencies` now declares the client packages the browser half actually loads
  (`dsh-client-locale`, `dsh-client-ui-plugin-manager`, `dsh-client-ui-primitives`,
  `dsh-client-ui-slots`), and the DSH ranges are bounded below by `>=0.2.0-rc.1` — the
  first release with the slot API this plugin uses.

## 0.1.2

### Fixed

- The Settings card now registers into **`settings.plugins.tab`** (Plugins -> Git Connector tab)
  instead of the removed `settings.plugin.item` slot. DSH 0.2.0-rc.2 no longer declares the old
  name anywhere, so the card silently failed to appear there and the section tab had no label.
  The card also supplies a `label` so the tab reads "Git Connector" in the Plugins nav.
- Removed the stale `dsh.client.inject: ["@deepseek-ai/dsh-client-runtime"]` declaration from the
  manifest. That package does not exist in DSH 0.2.0-rc.2 and the field only ever carried
  loading/prefetch metadata, so dropping it changes no behavior.

## 0.1.1

### Added

- A **Git executable path** setting in the Settings card (Settings -> Plugins -> Git Connector),
  showing the effective source alongside the resolved binary and version. Resolution order:
  settings card -> profile config (`gitPath`) -> auto-detection.
- A **Prerequisites** section with per-platform git installation instructions in both READMEs.

### Changed

- The provider form's **site address** field is now kind-aware. For `github` it explains that
  public GitHub must leave it empty; for `gitea` / `forgejo` it states that one address serves
  both the API and git.

### Fixed

- Choosing `github` while the site address held `https://github.com` now clears that address.
  GitHub serves its API from `api.github.com` and git from `github.com`, so a site address is
  treated as GitHub Enterprise and expands to `<address>/api/v3` - which left git transport
  working while every forge API call failed.

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
