# dsh-git-connector

> DeepSeek Harness（DSH）的 **Git 仓库连接插件**：保存 Gitea / Forgejo / GitHub 托管与仓库档案，
> 让 agent **用档案名**连接仓库、完成常规仓库操作，并把**忽略证书、允许覆盖**这类危险开关
> **按仓库单独授权**。

密钥保存在 **DSH 凭据中心**（`~/.dsh/.credentials.yaml`），插件数据里只保存引用名 —— 不落明文。

## 与社区插件的关系

本插件聚焦 **Git 传输 + Forge API**，面向 **Gitea / Forgejo / 自建实例**，同时支持 GitHub。
社区的 `dsh-github-connector` 聚焦 GitHub 的 PR 审查与合并流程。两者**功能互补，可以共存**。

## 安装

在 DSH profile 的 `package.json` 中加入依赖并登记 bundle：

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

插件**没有运行时依赖**：git 以子进程调用，HTTP 使用 Node 内置的 `node:https`。

## 快速开始

### 1. 添加托管

`@
git_provider_add { name: "my-gitea", kind: "gitea", baseUrl: "https://git.example.com", username: "alice" }
`@

密钥引用名会按约定自动推导为 `DSH_GIT_CONNECTOR_MY_GITEA_TOKEN`。

### 2. 保存密钥

打开 **设置 → Plugins → Git Connector**，在托管那一行粘贴 token，点击**保存密钥**。
也可以直接写入 `~/.dsh/.credentials.yaml`，或使用同名环境变量。

验证：

`@
git_provider_test { provider: "my-gitea" }
`@

### 3. 添加仓库档案

`@
git_repo_add { name: "my-project", providerRef: "my-gitea", owner: "alice", repo: "my-project" }
`@

远程地址由 `gitBaseUrl + owner/repo` **自行推导**。

### 4. 用档案名操作

`@
git_clone  { repo: "my-project" }
git_status { repo: "my-project" }
git_commit { repo: "my-project", message: "feat: ..." }
git_push   { repo: "my-project" }
`@

后续所有操作**只需要档案名** —— agent 不必知道 URL、凭据或本地路径。

## Agent 工具

| 分组 | 工具 |
|---|---|
| 托管 | `git_provider_list` `git_provider_add` `git_provider_update` `git_provider_remove` `git_provider_test` |
| 仓库档案 | `git_repo_list` `git_repo_add` `git_repo_update` `git_repo_remove` |
| Git 操作 | `git_clone` `git_fetch` `git_pull` `git_push` `git_status` `git_branch` `git_diff` `git_log` `git_commit` |
| Forge API | `forge_repo_list` `forge_repo_create` `forge_repo_info` `forge_branch_list` `forge_contents` `forge_pull_list` `forge_pull_create` `forge_issue_create` |
| 凭据 | `git_credential_status` |

档案管理与执行动作严格分开：`git_repo_*` 只维护档案，`git_*` 才作用于仓库。

## 按仓库的独立开关

生效值 = `repo.flags[key]` → provider 字段 → **全局配置** → **内置默认**。

| 开关 | 默认 | 作用 |
|---|---|---|
| `insecureTls` | 继承 provider / 全局（**false**） | **忽略证书校验**（自签名实例的逃生门；能用 `caFile` 就不要用它） |
| `caFile` | 继承 provider | 用 PEM 证书校验（比 `insecureTls` 安全） |
| `overwriteLocal` | **false**（仓库独有） | **允许破坏本地工作副本**：clone 进非空目录（先备份目录）、pull 丢弃改动（先 stash）、删除未合并分支（记录 SHA） |
| `overwriteRemote` | **false**（仓库独有） | **允许改写远端历史**（force push） |
| `allowForcePush` | 继承全局（默认 **false**） | force push 的第一道闸 |
| `allowForceDefaultBranch` | **false**（仓库独有） | 允许 force push 默认分支 |
| `allowOutsideWorkspace` | 继承全局（默认 **false**） | 允许 `localPath` 越出工作区根目录 |
| `readOnly` | **false**（仓库独有） | 一键只读：拒绝所有写操作 |
| `fetchPrune` | true | fetch 时附带 `--prune` |
| `commitIdentity` | 继承全局 `instanceLabel` | 提交署名标签 |

### 「覆盖」类操作的约定

打开 `overwriteLocal` 后，**每个破坏性操作都会返回可回滚的凭据**（备份目录路径、`stash@{0}`、
被删分支的 SHA、远端原 SHA），不存在「开了开关就静默丢数据」的路径。

force push 需要**四道闸同时打开**：

`@
global.allowForcePush  ∧  repo.flags.allowForcePush  ∧
repo.flags.overwriteRemote  ∧  调用传 confirmForce: true
（且目标分支 ≠ 默认分支，除非再开 allowForceDefaultBranch）
`@

## 安全设计

| 项 | 做法 |
|---|---|
| 密钥存储 | 只保存**引用名**；值存放于 DSH 凭据中心 |
| 密钥注入 git | 每次操作生成临时 `GIT_ASKPASS` 助手，值通过**环境变量**传递 —— 不进命令行参数、不进 URL、不落盘；用完即删，异常残留会在启动时清扫 |
| 子进程纪律 | 只使用 `spawn(git, argv[])`，**不拼接 shell 字符串** |
| 凭据助手 | 每次调用重置 `credential.helper`，系统凭据管理器不会接触或缓存插件使用的 token |
| TLS | 默认**校验证书**；`insecureTls` 只对**当次请求**构造 agent，不修改进程级 TLS 状态 |
| SSRF | `allowRawUrl` 默认关闭：没有托管就不能连接任意 URL |
| 路径围栏 | `localPath` 必须落在 `workspaceRoot` 内，除非该档案显式开启 `allowOutsideWorkspace` |
| 浏览器围栏 | 设置页接口仅回环地址（或 `trustedHosts`）可访问 |
| 提交署名 | 插件产生的提交署名为 `dsh-git-connector[<instanceLabel>]`，与用户及其他 agent 的提交可区分 |

## 配置

```yaml
gitPath: ""                  # 自定义 git 可执行文件；留空则自动探测
gitTimeoutMs: 300000         # 单条 git 命令超时
gitOutputLimit: 1048576      # stdout/stderr 截断上限（字节）
workspaceRoot: ""            # 本地工作副本根目录；留空则用 ~/.dsh/dsh-git-connector/workspaces
allowOutsideWorkspace: false
allowForcePush: false
allowRawUrl: false
allowInsecure: false
httpTimeoutMs: 30000
maxOutputLines: 2000
promptSectionOrder: 570
instanceLabel: ""            # 提交署名标签，例如 "desktop-1"
trustedHosts: []
```

## 许可

MIT
