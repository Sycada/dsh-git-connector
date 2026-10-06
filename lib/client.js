window.__ModuleLoader__.load({
  id: "dsh-git-connector",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var ui = require("@deepseek-ai/dsh-client-ui-primitives");
    var Input = ui && ui.Input ? ui.Input : "input";

    var css = [
      ".dgc-item{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:12px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.05));margin:6px 0;overflow:hidden}",
      ".dgc-head{width:100%;display:flex;align-items:center;gap:10px;padding:10px 14px;background:transparent;border:0;cursor:pointer;color:inherit;font:inherit;text-align:left}",
      ".dgc-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06))}",
      ".dgc-title{flex:1;min-width:0;font-size:14px;font-weight:600}",
      ".dgc-sub{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85));font-size:12.5px;font-weight:400}",
      ".dgc-body{padding:2px 14px 14px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28))}",
      ".dgc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".dgc-field{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}",
      ".dgc-field:first-of-type{border-top:0}",
      ".dgc-label{font-size:13px;color:var(--dsw-alias-label-secondary,inherit)}",
      ".dgc-hint{font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}",
      ".dgc-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
      ".dgc-err{color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12.5px;padding:6px 0}",
      ".dgc-ok{color:var(--dsw-alias-state-success-primary,#30a46c);font-size:12.5px;padding:6px 0}",
      ".dgc-warn{color:var(--dsw-alias-state-warning-primary,#f5a623);font-size:12.5px;padding:6px 0}",
      ".dgc-btn{appearance:none;font:inherit;font-size:13px;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 12px;background:transparent;color:var(--dsw-alias-label-primary,inherit)}",
      ".dgc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}",
      ".dgc-btn:disabled{opacity:.4;cursor:default}",
      ".dgc-btn.primary{background:var(--dsw-alias-label-primary,currentColor);color:var(--dsw-alias-bg-layer-1,#111)}",
      ".dgc-btn.danger{color:var(--dsw-alias-state-error-primary,#e5484d)}",
      ".dgc-item2{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:10px;padding:8px 10px;margin:6px 0}",
      ".dgc-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dgc-meta{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dgc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:0 14px}",
      ".dgc-chip{font-size:11px;border-radius:6px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35))}",
      ".dgc-chip.on{color:var(--dsw-alias-state-success-primary,#30a46c);border-color:currentColor}",
      ".dgc-chip.off{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}",
      ".dgc-chip.danger{color:var(--dsw-alias-state-warning-primary,#f5a623);border-color:currentColor}",
      ".dgc-flag{display:flex;align-items:center;gap:8px;padding:4px 0;flex-wrap:wrap}",
      ".dgc-flagName{font-family:ui-monospace,Menlo,monospace;font-size:12px;min-width:175px}",
      ".dgc-sel{font:inherit;font-size:12px;border-radius:7px;padding:3px 7px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,inherit)}",
      ".dgc-sep{height:1px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.28));margin:12px 0}",
    ].join("");

    if (typeof document !== "undefined" && !document.getElementById("dgc-css")) {
      var style = document.createElement("style");
      style.id = "dgc-css";
      style.textContent = css;
      document.head.appendChild(style);
    }

    var RAW = {
      title: ["Git 仓库连接", "Git Connector"],
      desc: ["仓库档案 / 工作副本操作 / Gitea·GitHub API。密钥存 DSH 凭据中心，不在本页或插件数据里落明文。", "Repo profiles, work-copy operations and Gitea/GitHub APIs. Keys live in the DSH credential center."],
      providers: ["仓库托管（Provider）", "Providers"],
      repos: ["仓库档案", "Repo profiles"],
      addProvider: ["新建托管", "New provider"],
      addRepo: ["新建档案", "New profile"],
      refresh: ["刷新", "Refresh"],
      save: ["保存", "Save"],
      cancel: ["取消", "Cancel"],
      edit: ["编辑", "Edit"],
      remove: ["删除", "Delete"],
      test: ["测试", "Test"],
      name: ["名称", "Name"],
      kind: ["类型", "Kind"],
      baseUrl: ["站点地址", "Base URL"],
      apiBaseUrl: ["API 地址", "API base URL"],
      gitBaseUrl: ["Git 地址", "Git base URL"],
      authType: ["认证方式", "Auth"],
      username: ["账号", "Username"],
      tokenRef: ["密钥引用", "Key reference"],
      caFile: ["CA 证书", "CA file"],
      allowInsecure: ["默认忽略证书校验", "Skip TLS verification by default"],
      defaultBranch: ["默认分支", "Default branch"],
      owner: ["组织/用户", "Owner"],
      repoName: ["仓库名", "Repository"],
      localPath: ["本地路径", "Local path"],
      providerRef: ["所属托管", "Provider"],
      flags: ["仓库独立开关", "Per-repo flags"],
      flagInherit: ["继承", "inherit"],
      flagOn: ["开", "on"],
      flagOff: ["关", "off"],
      keyTitle: ["密钥", "Key"],
      keySet: ["已设置", "set"],
      keyMissing: ["未设置", "NOT SET"],
      saveKey: ["保存密钥", "Save key"],
      clearKey: ["清除密钥", "Clear key"],
      keyPh: ["粘贴 token（不回显）", "Paste token (never echoed)"],
      keyHint: ["密钥保存在 ~/.dsh/.credentials.yaml，插件数据里只有引用名。", "The key is stored in ~/.dsh/.credentials.yaml; only its reference name lives in plugin data."],
      noProviders: ["还没有托管。点“新建托管”添加 Gitea/GitHub。", "No providers yet. Click New provider to add a Gitea or GitHub instance."],
      noRepos: ["还没有仓库档案。添加后 agent 就能用档案名操作仓库。", "No repo profiles yet. Add one so the agent can operate the repo by name."],
      localCloned: ["已克隆", "cloned"],
      localMissing: ["未克隆", "not cloned"],
      notGit: ["目录存在但不是 git 工作副本", "directory present but not a git work copy"],
      mismatch: ["远端不匹配", "remote mismatch"],
      status: ["状态", "Status"],
      clone: ["克隆", "Clone"],
      pull: ["拉取", "Pull"],
      copyPath: ["复制路径", "Copy path"],
      copied: ["已复制", "Copied"],
      delRepoAsk: ["删除档案？只删除档案，不动本地副本和远端。", "Delete this profile? The local copy and the remote are left untouched."],
      delProvAsk: ["删除托管？", "Delete this provider?"],
      delProvOnly: ["仅删除", "Delete only"],
      delProvCred: ["删除并清除密钥", "Delete + clear key"],
      gitInfo: ["Git", "Git"],
      workspace: ["工作区根目录", "Workspace root"],
      flagsFor: ["开关（生效值 / 来源）", "Flags (effective / source)"],
      testing: ["测试中", "testing"],
      tlsWarn: ["该仓库已关闭证书校验", "TLS verification is disabled for this repo"],
      saved: ["已保存", "Saved"],
      required: ["名称必填", "Name is required"],
      refRule: ["引用名只能含字母/数字/下划线，且以字母或下划线开头", "A reference may contain only letters, digits and underscores, starting with a letter or underscore"],
      allowInsecureNote: ["仅在自签名实例上开启；能用 CA 证书就不要跳过校验。", "Only for self-signed instances; prefer a CA file over skipping verification."],
      basePhGitea: ["https://git.example.com:3000", "https://git.example.com:3000"],
      basePhGithub: ["公开 GitHub 留空；仅 GitHub Enterprise 填站点根地址", "Leave empty for public GitHub; site root for GitHub Enterprise only"],
      baseHintGitea: ["Gitea / Forgejo 的 API 与 git 同源，填站点地址即可（会同时作为 API 与 git 地址）。", "Gitea / Forgejo serve the API and git from one origin - enter the site address (it becomes both)."],
      baseHintGithub: ["GitHub 的 API 在 api.github.com、git 在 github.com，所以公开 GitHub 这里必须留空。只有 GitHub Enterprise 才填（会自动补 /api/v3）。", "GitHub splits api.github.com from github.com, so this MUST be empty for public GitHub. Fill it only for GitHub Enterprise (the /api/v3 prefix is added automatically)."],
      baseWarnGithub: ["已填站点地址 → 将按 GitHub Enterprise 处理，API 会变成 <地址>/api/v3；在公开 GitHub 上会失败。公开 GitHub 请清空此项。", "A site address means GitHub Enterprise: the API becomes <address>/api/v3, which fails on public GitHub. Clear this field for public GitHub."],
      baseAutoCleared: ["已自动清空站点地址：github.com 不是 API 地址。", "Cleared the site address automatically: github.com is not an API address."],
      settingsTitle: ["插件配置", "Plugin settings"],
      gitPath: ["Git 可执行文件路径", "Git executable path"],
      gitPathPh: ["留空 = 自动探测（PATH / 常见安装位置）", "Empty = auto-detect (PATH / common install locations)"],
      gitPathHint: ["当前生效来源", "Effective source"],
      gitPathSaved: ["Git 路径已保存", "Git path saved"],
      gitPathMissing: ["该路径下没有可用的 git", "no usable git at that path"],
      redetect: ["恢复自动探测", "Auto-detect"],
      sourceSettings: ["配置页", "settings"],
      sourceConfig: ["profile 配置", "profile config"],
      sourceAuto: ["自动探测", "auto-detected"],
    };
    var T = (function () {
      var zh = typeof navigator !== "undefined" && /^zh/i.test(navigator.language || "");
      var out = {};
      for (var k in RAW) out[k] = zh ? RAW[k][0] : RAW[k][1];
      return out;
    })();

    var h = react.createElement;

    async function api(path, options) {
      var res = await fetch("/dsh-git-connector/api" + path, Object.assign({ headers: { "content-type": "application/json" } }, options || {}));
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok || !data || data.ok === false) {
        var msg = data && (data.error || data.message);
        throw new Error((typeof msg === "string" && msg) ? msg.slice(0, 400) : ("HTTP " + res.status));
      }
      return data;
    }

    function ACT(p) {
      return h("button", {
        type: "button",
        className: ["dgc-btn", p.primary ? "primary" : "", p.danger ? "danger" : ""].filter(Boolean).join(" "),
        onClick: p.onClick,
        disabled: p.disabled,
        title: p.title || "",
      }, p.label);
    }

    function Field(label, node) {
      return h("div", { className: "dgc-field" },
        h("div", { className: "dgc-label" }, label),
        node);
    }

    function TextInput(props) {
      return h(Input, Object.assign({ type: "text" }, props));
    }

    var EMPTY_PROVIDER = { id: "", name: "", kind: "gitea", baseUrl: "", apiBaseUrl: "", gitBaseUrl: "", authType: "token", username: "", tokenRef: "", caFile: "", allowInsecure: false, defaultBranch: "main" };
    var EMPTY_REPO = { id: "", name: "", providerRef: "", owner: "", repo: "", localPath: "", defaultBranch: "", flags: {} };

    function ProviderForm(props) {
      var form = props.form, setForm = props.setForm;
      var set = function (k, v) { var next = Object.assign({}, form); next[k] = v; setForm(next); };
      return h("div", null,
        h("div", { className: "dgc-grid" },
          Field(T.name, TextInput({ value: form.name, placeholder: "my-gitea", onChange: function (e) { set("name", e.target.value); } })),
          Field(T.kind, h("select", { className: "dgc-sel", value: form.kind, onChange: function (e) {
            var next = e.target.value;
            // Switching to github while pointing at github.com is the classic
            // footgun (git works, every API call fails) - clear it for the user.
            if (next === "github" && /^https?:\/\/(www\.)?github\.com\/?$/i.test((form.baseUrl || "").trim())) {
              setForm(Object.assign({}, form, { kind: next, baseUrl: "" }));
              if (props.onNotice) props.onNotice(T.baseAutoCleared);
              return;
            }
            set("kind", next);
          } },
            ["gitea", "forgejo", "github"].map(function (k) { return h("option", { key: k, value: k }, k); }))),
          Field(T.baseUrl, h("div", null,
            TextInput({
              value: form.baseUrl,
              placeholder: form.kind === "github" ? T.basePhGithub : T.basePhGitea,
              onChange: function (e) { set("baseUrl", e.target.value); },
            }),
            h("div", { className: "dgc-hint", style: { marginTop: 4 } }, form.kind === "github" ? T.baseHintGithub : T.baseHintGitea),
            form.kind === "github" && (form.baseUrl || "").trim() !== "" ? h("div", { className: "dgc-warn" }, T.baseWarnGithub) : null)),
          Field(T.username, TextInput({ value: form.username, placeholder: "sycada", onChange: function (e) { set("username", e.target.value); } })),
          Field(T.authType, h("select", { className: "dgc-sel", value: form.authType, onChange: function (e) { set("authType", e.target.value); } },
            ["token", "basic", "ssh", "none"].map(function (k) { return h("option", { key: k, value: k }, k); }))),
          Field(T.tokenRef, TextInput({ value: form.tokenRef, placeholder: "DSH_GIT_CONNECTOR_<NAME>_TOKEN", onChange: function (e) { set("tokenRef", e.target.value); } })),
          Field(T.caFile, TextInput({ value: form.caFile, placeholder: "C:\\path\\ca.pem", onChange: function (e) { set("caFile", e.target.value); } })),
          Field(T.defaultBranch, TextInput({ value: form.defaultBranch, placeholder: "main", onChange: function (e) { set("defaultBranch", e.target.value); } })),
          Field(T.allowInsecure, h("label", { className: "dgc-row" },
            h("input", { type: "checkbox", checked: form.allowInsecure === true, onChange: function (e) { set("allowInsecure", e.target.checked); } }),
            h("span", { className: "dgc-hint" }, T.allowInsecureNote)))
        ),
        h("div", { className: "dgc-row", style: { marginTop: 10 } },
          ACT({ label: T.save, primary: true, onClick: props.onSave, disabled: props.busy }),
          ACT({ label: T.cancel, onClick: props.onCancel }))
      );
    }

    function FlagEditor(props) {
      var details = props.details || [];
      if (!details.length) return null;
      return h("div", null,
        h("div", { className: "dgc-label", style: { paddingTop: 8 } }, T.flags),
        details.map(function (f) {
          var isBool = typeof f.value === "boolean" || f.key === "readOnly" || f.key === "overwriteLocal";
          var current = props.value[f.key];
          var value = current === undefined || current === null ? "" : String(current);
          return h("div", { className: "dgc-flag", key: f.key },
            h("span", { className: "dgc-flagName" }, f.key),
            h("select", {
              className: "dgc-sel",
              value: value,
              onChange: function (e) {
                var v = e.target.value;
                var next = Object.assign({}, props.value);
                if (v === "") next[f.key] = null; else next[f.key] = (v === "true" ? true : v === "false" ? false : v);
                props.onChange(next);
              },
            },
              h("option", { value: "" }, T.flagInherit),
              h("option", { value: "true" }, T.flagOn),
              h("option", { value: "false" }, T.flagOff)),
            f.dangerous ? h("span", { className: "dgc-chip danger" }, "dangerous") : null,
            f.repoOnly ? h("span", { className: "dgc-chip off" }, "repo-only") : null,
            h("span", { className: "dgc-hint" }, f.description || ""));
        })
      );
    }

    function RepoForm(props) {
      var form = props.form, setForm = props.setForm;
      var providers = props.providers || [];
      var set = function (k, v) { var next = Object.assign({}, form); next[k] = v; setForm(next); };
      return h("div", null,
        h("div", { className: "dgc-grid" },
          Field(T.name, TextInput({ value: form.name, placeholder: "dsh-git-connector", onChange: function (e) { set("name", e.target.value); } })),
          Field(T.providerRef, h("select", { className: "dgc-sel", value: form.providerRef, onChange: function (e) { set("providerRef", e.target.value); } },
            [h("option", { key: "", value: "" }, "-")].concat(providers.map(function (p) { return h("option", { key: p.name, value: p.name }, p.name); })))),
          Field(T.owner, TextInput({ value: form.owner, placeholder: "sycada", onChange: function (e) { set("owner", e.target.value); } })),
          Field(T.repoName, TextInput({ value: form.repo, placeholder: "dsh-git-connector", onChange: function (e) { set("repo", e.target.value); } })),
          Field(T.localPath, TextInput({ value: form.localPath, placeholder: "(default: <workspace>/<owner>/<repo>)", onChange: function (e) { set("localPath", e.target.value); } })),
          Field(T.defaultBranch, TextInput({ value: form.defaultBranch, placeholder: "main", onChange: function (e) { set("defaultBranch", e.target.value); } }))
        ),
        h(FlagEditor, { details: props.flagDetails || [], value: form.flags || {}, onChange: function (next) { set("flags", next); } }),
        h("div", { className: "dgc-row", style: { marginTop: 10 } },
          ACT({ label: T.save, primary: true, onClick: props.onSave, disabled: props.busy }),
          ACT({ label: T.cancel, onClick: props.onCancel }))
      );
    }

    function Card(props) {
      var openState = react.useState(!!(props && props.defaultOpen));
      var open = openState[0], setOpen = openState[1];
      var stateStore = react.useState({ loading: false, error: "", data: null });
      var state = stateStore[0], setState = stateStore[1];
      var formStore = react.useState(null);
      var form = formStore[0], setForm = formStore[1];
      var provFormStore = react.useState(null);
      var provForm = provFormStore[0], setProvForm = provFormStore[1];
      var noteStore = react.useState({ text: "", ok: null });
      var note = noteStore[0], setNote = noteStore[1];
      var keyStore = react.useState({});
      var keys = keyStore[0], setKeys = keyStore[1];
      var busyStore = react.useState("");
      var busy = busyStore[0], setBusy = busyStore[1];
      var gitPathStore = react.useState(null);
      var gitPath = gitPathStore[0], setGitPath = gitPathStore[1];
      var gen = react.useRef(0);
      var loadedOnce = react.useRef(false);

      var load = react.useCallback(async function () {
        var id = ++gen.current;
        setState(function (s) { return Object.assign({}, s, { loading: true }); });
        try {
          var data = await api("/state");
          if (id === gen.current) setState({ loading: false, error: "", data: data.data });
        } catch (e) {
          if (id === gen.current) setState({ loading: false, error: String(e.message || e), data: null });
        }
      }, []);

      react.useEffect(function () {
        if (open && !loadedOnce.current) { loadedOnce.current = true; load(); }
      }, [open, load]);

      var say = function (text, ok) { setNote({ text: text, ok: ok }); };

      var sourceLabel = function (source) {
        return source === "settings" ? T.sourceSettings : source === "config" ? T.sourceConfig : T.sourceAuto;
      };

      var putGitPath = async function (value) {
        setBusy("gitpath");
        try {
          var out = await api("/settings", { method: "PUT", body: JSON.stringify({ settings: { gitPath: value } }) });
          setGitPath(null);
          await load();
          say(T.gitPathSaved + ": " + (out.git.binary || "?") + (out.git.error ? " / " + out.git.error : ""), !out.git.error);
        } catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var saveProvider = async function () {
        if (!provForm) return;
        if (!(provForm.name || "").trim()) { say(T.required, false); return; }
        var refOk = /^[A-Za-z_][A-Za-z0-9_]*$/;
        if (provForm.tokenRef && !refOk.test(provForm.tokenRef)) { say(T.refRule, false); return; }
        setBusy("prov");
        try {
          var body = Object.assign({}, provForm);
          if (provForm.id) await api("/providers/" + encodeURIComponent(provForm.id), { method: "PUT", body: JSON.stringify({ provider: body }) });
          else await api("/providers", { method: "POST", body: JSON.stringify({ provider: body }) });
          setProvForm(null); await load(); say(T.saved, true);
        } catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var saveRepo = async function () {
        if (!form) return;
        if (!(form.name || "").trim()) { say(T.required, false); return; }
        setBusy("repo");
        try {
          var body = Object.assign({}, form);
          if (form.id) await api("/repos/" + encodeURIComponent(form.id), { method: "PUT", body: JSON.stringify({ repo: body }) });
          else await api("/repos", { method: "POST", body: JSON.stringify({ repo: body }) });
          setForm(null); await load(); say(T.saved, true);
        } catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var saveKey = async function (p) {
        var value = keys[p.name] || "";
        if (!value) return;
        setBusy(p.name + ":key");
        try {
          await api("/providers/" + encodeURIComponent(p.id) + "/key", { method: "POST", body: JSON.stringify({ value: value }) });
          setKeys(function (k) { var n = Object.assign({}, k); n[p.name] = ""; return n; });
          await load(); say(p.name + ": " + T.keySet, true);
        } catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var clearKey = async function (p) {
        setBusy(p.name + ":clear");
        try {
          await api("/providers/" + encodeURIComponent(p.id) + "/key", { method: "DELETE" });
          await load(); say(p.name + ": " + T.keyMissing, true);
        } catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var testProvider = async function (p) {
        setBusy(p.name + ":test");
        try {
          var out = await api("/providers/" + encodeURIComponent(p.id) + "/test", { method: "POST", body: "{}" });
          say(p.name + ": " + (out.ok ? "OK" : "FAILED") + " - version " + (out.version || "?") + (out.authenticated ? " as " + (out.login || "?") : "") + (out.error ? " / " + out.error : ""), out.ok === true);
        } catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var repoAction = async function (r, action) {
        setBusy(r.name + ":" + action);
        try {
          var out = await api("/repos/" + encodeURIComponent(r.id) + "/" + action, { method: "POST", body: "{}" });
          if (action === "status") {
            say(r.name + ": " + (out.ok ? ((out.branch || "?") + (out.clean ? " clean" : " dirty")) : ("FAILED " + (out.error || ""))), out.ok === true);
          } else {
            say(r.name + " " + action + ": " + (out.ok ? "OK" : "FAILED " + (out.stderr || out.error || "")), out.ok === true);
          }
          await load();
        } catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var removeRepo = async function (r) {
        setBusy(r.name + ":del");
        try { await api("/repos/" + encodeURIComponent(r.id), { method: "DELETE" }); await load(); say(T.remove + " " + r.name, true); }
        catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var removeProvider = async function (p, clear) {
        setBusy(p.name + ":del");
        try { await api("/providers/" + encodeURIComponent(p.id) + (clear ? "?clear=1" : ""), { method: "DELETE" }); await load(); say(T.remove + " " + p.name, true); }
        catch (e) { say(String(e.message || e), false); }
        setBusy("");
      };

      var copyPath = function (r) {
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(r.localPath).then(function () { say(T.copied, true); }, function () { window.prompt("path", r.localPath); });
          else window.prompt("path", r.localPath);
        } catch (e) { window.prompt("path", r.localPath); }
      };

      var body = null;
      if (open) {
        if (state.loading && !state.data) body = h("div", { className: "dgc-hint" }, "...");
        else if (!state.data) body = h("div", { className: "dgc-err" }, state.error || "...");
        else {
          var data = state.data;
          var flagDetails = (data.repos[0] && data.repos[0].flagDetails) || [];
          body = h("div", null,
            note.text ? h("div", { className: note.ok === false ? "dgc-err" : note.ok === true ? "dgc-ok" : "dgc-hint" }, note.text) : null,
            h("div", { className: "dgc-hint dgc-code" }, T.gitInfo + ": " + (data.git.binary || "?") + "  " + (data.git.version || data.git.error || "")),
            h("div", { className: "dgc-hint dgc-code" }, T.workspace + ": " + (data.workspaceRoot || "?")),

            h("div", { className: "dgc-field", style: { paddingTop: 10 } },
              h("div", { className: "dgc-label" }, T.gitPath),
              h("div", { className: "dgc-row" },
                h(Input, {
                  type: "text",
                  value: gitPath === null ? (data.settings.gitPath || "") : gitPath,
                  placeholder: T.gitPathPh,
                  style: { width: 360 },
                  onChange: function (e) { setGitPath(e.target.value); },
                }),
                ACT({ label: T.save, primary: true, disabled: busy === "gitpath", onClick: function () { putGitPath(gitPath === null ? (data.settings.gitPath || "") : gitPath); } }),
                ACT({ label: T.redetect, disabled: busy === "gitpath", onClick: function () { putGitPath(""); } })
              ),
              h("div", { className: "dgc-hint" }, T.gitPathHint + ": " + sourceLabel(data.settings.gitPathSource) + "  ->  " + (data.git.binary || "?") + (data.git.version ? "  (" + data.git.version + ")" : ""))
            ),

            h("div", { className: "dgc-sep" }),
            h("div", { className: "dgc-row" }, h("div", { className: "dgc-name" }, T.providers), h("div", { className: "dgc-hint" }, String(data.providers.length))),
            provForm ? h("div", null, h(ProviderForm, { form: provForm, setForm: setProvForm, onSave: saveProvider, onCancel: function () { setProvForm(null); }, busy: busy === "prov", onNotice: function (text) { say(text, true); } }), h("div", { className: "dgc-sep" })) : null,
            data.providers.length === 0 && !provForm ? h("div", { className: "dgc-hint" }, T.noProviders)
              : data.providers.map(function (p) {
                  var keyValue = keys[p.name] || "";
                  return h("div", { className: "dgc-item2", key: p.id },
                    h("div", { className: "dgc-row" },
                      h("div", { style: { flex: 1, minWidth: 0 } },
                        h("div", { className: "dgc-name" }, p.name + "  "),
                        h("div", { className: "dgc-meta dgc-code" }, p.kind + "  " + p.apiBaseUrl + "  |  " + p.kind + " key " + (p.secretSet ? T.keySet : T.keyMissing) + "  " + (p.secretRef || "") + (p.secretSource ? " (" + p.secretSource + ")" : "") + (p.allowInsecure ? "  [" + T.allowInsecure + "]" : ""))),
                      ACT({ label: T.test, onClick: function () { testProvider(p); }, disabled: busy.indexOf(p.name) === 0 }),
                      ACT({ label: T.edit, onClick: function () { setProvForm(Object.assign({}, p, { tokenRef: p.tokenRef || "", baseUrl: "" })); } }),
                      ACT({ label: T.remove, danger: true, onClick: function () { if (window.confirm(T.delProvAsk + " " + p.name)) removeProvider(p, false); }, disabled: busy.indexOf(p.name) === 0 })
                    ),
                    h("div", { className: "dgc-row", style: { marginTop: 6 } },
                      h(Input, { type: "password", value: keyValue, placeholder: p.secretSet ? T.keySet + " - " + T.keyPh : T.keyPh, style: { width: 260 }, onChange: function (e) { var n = Object.assign({}, keys); n[p.name] = e.target.value; setKeys(n); } }),
                      ACT({ label: T.saveKey, primary: true, onClick: function () { saveKey(p); }, disabled: !keyValue || busy === p.name + ":key" }),
                      ACT({ label: T.clearKey, onClick: function () { clearKey(p); }, disabled: !p.secretSet || busy === p.name + ":clear" })
                    ),
                    h("div", { className: "dgc-hint" }, T.keyHint + "  " + (p.secretRef || ""))
                  );
                }),

            h("div", { className: "dgc-sep" }),
            h("div", { className: "dgc-row" }, h("div", { className: "dgc-name" }, T.repos), h("div", { className: "dgc-hint" }, String(data.repos.length))),
            form ? h("div", null, h(RepoForm, { form: form, setForm: setForm, providers: data.providers, flagDetails: flagDetails, onSave: saveRepo, onCancel: function () { setForm(null); }, busy: busy === "repo" }), h("div", { className: "dgc-sep" })) : null,
            data.repos.length === 0 && !form ? h("div", { className: "dgc-hint" }, T.noRepos)
              : data.repos.map(function (r) {
                  var local = r.local || {};
                  var localText = !local.present ? T.localMissing : (local.isRepo ? T.localCloned + " @ " + (local.head || "?") + (local.remoteMatches === false ? "  [" + T.mismatch + "]" : "") : T.notGit);
                  var on = (r.flagDetails || []).filter(function (f) { return f.value === true; });
                  return h("div", { className: "dgc-item2", key: r.id },
                    h("div", { className: "dgc-row" },
                      h("div", { style: { flex: 1, minWidth: 0 } },
                        h("div", { className: "dgc-name" }, r.name),
                        h("div", { className: "dgc-meta dgc-code" }, r.remoteUrl + "  ->  " + localText)),
                      ACT({ label: T.status, onClick: function () { repoAction(r, "status"); }, disabled: busy.indexOf(r.name) === 0 }),
                      ACT({ label: T.clone, onClick: function () { repoAction(r, "clone"); }, disabled: busy.indexOf(r.name) === 0 || local.isRepo === true }),
                      ACT({ label: T.pull, onClick: function () { repoAction(r, "pull"); }, disabled: busy.indexOf(r.name) === 0 || local.isRepo !== true }),
                      ACT({ label: T.copyPath, onClick: function () { copyPath(r); } }),
                      ACT({ label: T.edit, onClick: function () { setForm(Object.assign({}, r, { localPath: r.localPath || "", flags: r.flags || {} })); } }),
                      ACT({ label: T.remove, danger: true, onClick: function () { if (window.confirm(T.delRepoAsk)) removeRepo(r); }, disabled: busy.indexOf(r.name) === 0 })
                    ),
                    h("div", { className: "dgc-meta dgc-code", style: { marginTop: 4 } }, r.localPath),
                    (on.length || r.tlsInsecure) ? h("div", { className: "dgc-row", style: { marginTop: 4 } },
                      (r.flagDetails || []).map(function (f) {
                        if (f.value !== true) return null;
                        return h("span", { key: f.key, className: "dgc-chip " + (f.dangerous ? "danger" : "on") }, f.key + (f.source !== "repo" ? "/" + f.source : ""));
                      }),
                      r.tlsInsecure ? h("span", { className: "dgc-chip danger" }, T.tlsWarn) : null) : null
                  );
                }),

            h("div", { className: "dgc-sep" }),
            h("div", { className: "dgc-row" },
              h("div", { className: "dgc-hint", style: { flex: 1 } }, T.desc),
              ACT({ label: T.refresh, onClick: load }),
              ACT({ label: T.addRepo, primary: true, onClick: function () { setProvForm(null); setForm(Object.assign({}, EMPTY_REPO, { providerRef: (data.providers[0] || {}).name || "" })); } }),
              ACT({ label: T.addProvider, onClick: function () { setForm(null); setProvForm(Object.assign({}, EMPTY_PROVIDER)); } })
            )
          );
        }
      }

      return h("div", { className: "dgc-item" },
        h("button", { type: "button", className: "dgc-head", onClick: function () { setOpen(!open); }, "aria-expanded": open },
          h("span", { style: { flex: 1, minWidth: 0, textAlign: "left" } },
            h("div", { className: "dgc-title" }, T.title),
            h("div", { className: "dgc-sub" }, T.desc)),
          h("span", { className: "dgc-hint" }, open ? "\u25b2" : "\u25bc")),
        open ? h("div", { className: "dgc-body" }, body) : null
      );
    }

    function SectionCard() { return h(Card, { defaultOpen: true }); }

    var inject = ["slots"];
    function apply(ctx) {
      ctx.slots.inject("settings.plugins.tab", function () {
        return ctx.slots.register({ name: "settings.plugins.tab", id: "dsh-git-connector", order: 150, label: function () { return "Git Connector"; }, inject: function () { return {}; } }, Card);
      });
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({ name: "settings.section", id: "dsh-git-connector", order: 150, label: function () { return "Git Connector"; }, inject: function () { return {}; } }, SectionCard);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
