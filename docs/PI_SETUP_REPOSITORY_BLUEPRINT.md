# 跨平台 Pi 配置仓库设计蓝图

> 状态：设计参考，尚未开始迁移真实配置<br>
> 调研日期：2026-09-10<br>
> 目标平台：Windows、Linux、macOS<br>
> 当前基线：Pi `0.85.1`、Node.js `24.14.1`

## 1. 结论

本仓库应采用混合设计：

1. 仓库根目录是一个可通过 Git 安装的 **Pi Package**，只承载自有的 extensions、skills、prompts 和 themes。
2. 用声明式清单记录 Pi 版本、第三方包、外部技能及其固定版本或提交。
3. 用 `base + windows/linux/macos profile + local override` 生成或合并 `~/.pi/agent` 中的少量配置文件。
4. 用一个跨平台 Node.js bootstrap 实现预检、备份、合并、安装、验证和回滚；PowerShell 与 shell 文件只做薄入口。
5. `auth.json`、会话、缓存、通知 topic、日志和个人任务等运行时数据永远不进入 Git。

不建议把本仓库直接 clone 成 `~/.pi`。那种方式恢复快，但把“可移植配置”和“凭据、会话、缓存、机器路径”放在同一个 Git 工作区，长期更容易误提交秘密，也更难安全处理三种操作系统的差异。

## 2. 设计目标与边界

### 目标

- 新机器在安装 Git、Node.js 后，可用少量命令恢复熟悉的 Pi 环境。
- 重复执行 bootstrap 是幂等的，不重复安装、不破坏本机新增状态。
- 每次写入前支持 `--dry-run`，写入时自动备份被管理的文件。
- Windows、Linux、macOS 共用绝大多数配置，只在 profile 中保存平台差异。
- 第三方依赖可追溯、可审查、可固定、可升级、可回滚。
- CLI 与共享 `~/.pi/agent` 的客户端（例如 Percho）使用同一份安全配置。

### 非目标

- 不同步 OAuth、API key 或订阅登录状态；每台机器单独 `/login` 或设置环境变量。
- 不同步聊天会话、缓存、运行历史和临时状态。
- 不把个人知识、任务或 missions 默认放进公开配置仓库。
- 不在第一版自动发布 npm 包，也不每天自动升级依赖。
- 不承诺在完全空白的操作系统上自动安装 Git、Node.js 和系统终端；系统包管理器差异应留在前置步骤中。

## 3. 四个参考仓库的取舍

调研以以下提交为快照：

| 仓库 | 代表模式 | 值得采用 | 不直接照搬 |
| --- | --- | --- | --- |
| [mitsuhiko/agent-stuff@122e299](https://github.com/mitsuhiko/agent-stuff/tree/122e2994adddb113c04764c5697217dae120fcc6) | 成熟的可安装 Pi Package | 明确的 `package.json#pi`；资源按 extensions/skills/prompts/themes 分层；依赖、peerDependencies、版本和发布边界清楚 | 它是作者个人工作流包，含 macOS、Ghostty、tmux、私有服务等假设；不是整机 bootstrap |
| [bestony/bestony-pi@639881b](https://github.com/bestony/bestony-pi/tree/639881bc9617510b447adfc32ba1a5af96ddd027) | 聚合大量 Pi 包的 preset | 一条安装命令；显式 manifest；lockfile；OIDC 发布；安全警告清楚 | 大量 `bundledDependencies` 扩大供应链和安装体积；每日自动升级与 push-main 自动发版不适合“稳定恢复个人环境”；当前自有资源仍为空 |
| [cad0p/pi-config@d03f9e1](https://github.com/cad0p/pi-config/tree/d03f9e1ac0ef2a74b0eed10a74896b1cbae95dae) | 直接版本化真实 `~/.pi` | 恢复忠实度高；`.gitignore` 对 auth/session/cache 很有参考价值；pnpm lock、测试和复杂设置可复现 | Git 工作区与运行目录耦合；误提交秘密的爆炸半径更大；`settings.json` 中 provider、editor、trust 与 `@next` 包含个人和机器假设；已有 `~/.pi` 时不能直接 clone 覆盖 |
| [Jaxton07/percho@2326a0a](https://github.com/Jaxton07/percho/tree/2326a0aac0a7f6be3c0464f02c070c7391c88192) | 与 Pi CLI 共用配置的桌面客户端 | 验证 `~/.pi/agent` 是 CLI/GUI 共享边界；密钥应通过环境变量或安全凭据文件；明确处理 macOS/Linux GUI PATH 差异 | 它是桌面应用，不是配置模板；GUI 发布仅覆盖 macOS/Windows，不能作为 Linux bootstrap 基础 |

综合选择是：

- 以 `agent-stuff` 的 **Pi Package 边界**作为资源组织主干。
- 采用 `pi-config` 的 **忽略清单、锁定依赖和恢复意识**，但不把仓库本身放进 `~/.pi`。
- 采用 Percho 的 **共享目录、环境变量凭据和平台 PATH** 经验。
- 只吸收 `bestony-pi` 的 manifest、lockfile 和 CI 思路，暂不采用聚合打包及自动日更发布。

Pi `0.85.1` 的本机官方文档也支持这一方向：Pi Package 可经 npm、Git 或本地路径安装；`pi install` 管理 `settings.json`；固定版本的 npm 包和固定 ref 的 Git 包可保持不漂移；包内可声明 extensions、skills、prompts、themes。参考 [Pi Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) 与 [Quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md)。

## 4. 推荐仓库结构

```text
my-pi-setup/
├── README.md
├── package.json                 # 本仓库也是 Pi Package
├── package-lock.json            # 仅锁定本仓库运行时依赖
├── .gitignore
├── .gitleaks.toml
├── docs/
│   ├── PI_SETUP_REPOSITORY_BLUEPRINT.md
│   ├── RESTORE.md
│   └── UPDATING.md
├── config/
│   ├── settings.base.json       # 只放允许跨平台管理的稳定字段
│   ├── models.json              # 可选；只能引用 $ENV_VAR，不能写明文 key
│   ├── keybindings.json         # 可选；跨平台公共快捷键
│   ├── AGENTS.base.md           # 跨平台全局指令
│   └── profiles/
│       ├── windows/
│       │   ├── settings.json
│       │   └── AGENTS.md
│       ├── linux/
│       │   ├── settings.json
│       │   └── AGENTS.md
│       └── macos/
│           ├── settings.json
│           └── AGENTS.md
├── manifests/
│   ├── toolchain.json           # Pi 精确版本、Node 最低/已测试版本
│   ├── packages.lock.json       # 第三方 Pi 包的精确 npm 版本或 Git ref
│   └── external-assets.lock.json# 外部技能仓库 URL、commit、目标目录
├── extensions/
│   └── pi-notify/
│       └── index.ts
├── skills/                      # 只放自有或已明确 vendoring 的技能
├── prompts/
├── themes/
├── packages/                    # 仅放确有本地修改、不能直接引用上游的包
│   └── pi-check-agent-quota/
│       ├── UPSTREAM.md
│       ├── LICENSE
│       └── ...
├── bootstrap/
│   ├── bootstrap.mjs            # 唯一实现：detect/plan/apply/doctor/rollback
│   ├── bootstrap.ps1            # Windows 薄入口
│   └── bootstrap.sh             # Linux/macOS 薄入口
├── scripts/
│   ├── check-secrets.mjs
│   ├── diff-local.mjs
│   └── update-locks.mjs
└── test/
    ├── merge-config.test.mjs
    └── manifest.test.mjs
```

### 为什么根目录同时是 Pi Package

`package.json` 的 `pi` 字段让仓库内的自有资源可以被 Pi 作为一个整体加载：

```json
{
  "name": "my-pi-setup",
  "private": true,
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

这样无需把源码复制进 `~/.pi/agent/extensions`。bootstrap 可以让 Pi 通过带 commit/tag 的 Git source 安装本仓库，资源更新与回滚都由 Git ref 控制。

## 5. 三类数据必须分开

### A. 应进入 Git 的可移植配置

- 自有 extension、skill、prompt、theme 源码。
- 通用 `AGENTS.base.md`。
- 不含秘密的 `models.json`；`apiKey` 只允许写成 `$ENV_VAR` 或 `${ENV_VAR}`。
- 第三方包的 source、精确版本、Git commit 和启用/禁用过滤规则。
- 通用设置，如 theme、enabledModels、默认 provider/model 的期望值。
- bootstrap、测试、文档、CI 和 secret scan 规则。

### B. 由 bootstrap 生成或合并的机器配置

- `~/.pi/agent/settings.json`。
- `~/.pi/agent/AGENTS.md`，由公共内容与平台 profile 组合。
- `~/.pi/agent/models.json`，仅在确有自定义 provider 时生成。
- `~/.pi/agent/keybindings.json`。
- 本仓库安装状态文件，例如 `~/.pi/agent/my-pi-setup-state.json`。

bootstrap 只管理字段白名单，必须保留 Pi 自己或其他工具写入的未知字段。它不得整文件覆盖一个已存在的 `settings.json`。

### C. 永远不得进入 Git 的本地状态

至少包括：

```gitignore
# credentials and secret-like identifiers
auth.json
**/auth.json
*.env
.env*
pi-notify-topic

# private conversations and user data
sessions/
missions/
run-history.jsonl

# generated state, caches and catalogs
models-store.json
state/
web-search-cache/
*-cache.json
*.log

# package manager/runtime output
npm/
git/
bin/
node_modules/

# machine-only overrides and backups
config/local.override.json
.backups/
```

即使远端仓库设为 private，也不应提交这些文件。Git 历史中的秘密难以彻底清除，OAuth token、API key、ntfy topic 和会话内容都应视为凭据或隐私数据。

## 6. 配置合并模型

推荐优先级从低到高为：

```text
config/settings.base.json
        ↓
config/profiles/<detected-os>/settings.json
        ↓
config/local.override.json          # 每台机器私有，gitignored
        ↓
现有 ~/.pi/agent/settings.json 中不受管理的字段
```

合并原则：

- 对象递归合并。
- 数组不盲目拼接；`enabledModels` 等数组由对应层整体替换。
- `packages` 不在多个文件重复维护，唯一来源是 `manifests/packages.lock.json`，由 bootstrap 调用 `pi install` 管理。
- `lastChangelogVersion`、tracking、trust、缓存等 Pi 管理字段不进入模板，也不由 bootstrap 删除。
- `shellPath`、externalEditor、通知命令等机器相关设置只能出现在 platform profile 或 local override。
- 写入前产生 JSON diff；只有 `--apply` 才执行。

Windows 当前的全局 `AGENTS.md` 说明“bash 是 Git Bash，需要 Linux 时使用 WSL”。这应移动到 `profiles/windows/AGENTS.md`，不能继续作为所有平台共享指令。

## 7. 第三方依赖策略

### 默认：引用并固定，不复制源码

`manifests/packages.lock.json` 记录类似：

```json
{
  "packages": [
    { "source": "npm:pi-web-access@<exact-version>" },
    { "source": "npm:pi-subagents@<exact-version>", "filters": "preserve-current" },
    { "source": "npm:@plannotator/pi-extension@<exact-version>" },
    { "source": "npm:@narumitw/pi-goal@<exact-version>", "filters": "preserve-current" },
    { "source": "npm:@narumitw/pi-btw@<exact-version>" },
    { "source": "npm:pi-codex-fast-mode@<exact-version>" },
    { "source": "git:github.com/majorgilles/pi-grill-me@<commit>" }
  ]
}
```

上面的版本占位符必须在实施阶段从本机已安装元数据或 registry 核实后填写，不能凭当前 package name 猜测。

优点：

- 不把第三方代码伪装成自有代码。
- 每个依赖可以单独审查、升级和回滚。
- 避免 `bundledDependencies` 把大量扩展一起塞入本仓库。
- Pi 原生知道如何安装 npm/Git package，并把它们隔离在自己的包目录。

### 例外：有本地修改时才 vendoring

当前 `pi-check-agent-quota` 位于本机绝对路径，并显示版本 `0.1.2-gpt.2`，但包元数据指向上游 `Linen9/pi-check-agent-quota`。迁移前必须先与上游或已发布 npm 版本做 diff：

- 若无本地修改：改成固定版本的 `npm:pi-check-agent-quota@...`。
- 若确有需要保留的修改：放入 `packages/pi-check-agent-quota/`，保留 LICENSE，并新增 `UPSTREAM.md` 记录上游 URL、基线 commit、修改原因和同步方法。

当前两个独立技能仓库建议保留为固定提交的外部资产，而不是复制 `.git` 目录进本仓库：

- `keepongo/video-summarizer`：当前 commit `481a772745c6275bd53d97a2fc66f5ea402f8f6e`。
- `xingyaoww/show-me`：当前 commit `8eade74e24b901347e68b3ca223f1be2bf2181fb`。

bootstrap 将它们 clone 到 `~/.pi/agent/skills/<name>` 并 checkout 固定 commit。升级必须修改 lock manifest 并经过检查。

## 8. 从零恢复流程

### 通用前置条件

1. 安装 Git。
2. 安装 Node.js `>=22.19.0`；首版以 Node `24.14.1` 作为已测试版本。
3. clone 本仓库到普通源码目录，不要 clone 到 `~/.pi`。

例如：

```bash
git clone https://github.com/hill-wwy/my-pi-setup.git
cd my-pi-setup
```

### 预期命令界面

```bash
# 只检查，不修改
node bootstrap/bootstrap.mjs plan --profile auto

# 安装/核对指定 Pi 版本，备份并应用配置，安装固定依赖
node bootstrap/bootstrap.mjs apply --profile auto

# 用户在每台机器上完成订阅或 API key 认证
pi
/login

# 验证版本、资源、默认模型、凭据就绪情况和平台命令
node bootstrap/bootstrap.mjs doctor
```

PowerShell 与 POSIX shell 的入口最终只转发给同一个 Node 实现：

```powershell
.\bootstrap\bootstrap.ps1 plan
.\bootstrap\bootstrap.ps1 apply
```

```bash
./bootstrap/bootstrap.sh plan
./bootstrap/bootstrap.sh apply
```

### apply 必须执行的安全顺序

1. 检测 OS、CPU、home、Git、Node、npm、Pi 版本。
2. 检查仓库是否干净、manifest 是否完整、是否命中秘密规则。
3. 展示将改变的文件和 packages；没有 `--apply` 时退出。
4. 对即将修改的配置文件做带时间戳备份，记录 SHA-256。
5. 用精确版本安装 Pi：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent@<version>`。
6. 生成并合并平台配置，不覆盖未管理字段。
7. 按 lock manifest 安装第三方包与外部技能。
8. 通过带 commit/tag 的 Git source 安装本仓库 Pi Package。
9. 运行 doctor；若失败，保留备份并给出明确回滚命令。
10. 提醒用户执行 `/login`，而不是复制旧机器的 `auth.json`。

## 9. 更新与回滚

### 日常配置修改

- 先改仓库源文件或 manifest。
- 运行测试和 `plan` 查看本机差异。
- `apply` 后手动验证 Pi。
- 提交并打 tag；稳定机器默认引用 tag 或 commit，不跟随浮动 `main`、`latest`、`next`。

### 第三方升级

- 一次只升级少量包。
- 阅读 changelog 和源代码差异。
- 更新精确版本/ref 与 lockfile。
- 在 Windows、Linux、macOS CI matrix 上至少跑 manifest、JSON、bootstrap merge 和秘密检查。
- 人工 smoke test 后再打新 tag。

### 回滚

应支持两条路径：

```bash
# 重新应用上一稳定 tag
git checkout <previous-tag>
node bootstrap/bootstrap.mjs apply --profile auto

# 或恢复最近一次 apply 前的配置备份
node bootstrap/bootstrap.mjs rollback --latest
```

不采用 `git reset --hard` 清理用户运行目录，也不删除 `~/.pi/agent`。

## 10. 本机现状到目标结构的迁移映射

本次只读盘点发现：

| 本机现状 | 目标去向 | 处理方式 |
| --- | --- | --- |
| Pi `0.85.1`、Node `24.14.1` | `manifests/toolchain.json` | 记录 exact Pi 与 tested Node；另记录 Node 最低版本 |
| `settings.json` 中 8 个 packages | `packages.lock.json` | 查出已安装精确版本/ref，保留现有过滤规则后固定 |
| `settings.json` 中一个绝对本地包路径 | npm 固定版本或 `packages/` | 先对 `pi-check-agent-quota` 做上游 diff |
| `settings.json#shellPath` 是 Windows 绝对路径 | Windows profile/local override | 不进入 base |
| 全局 `AGENTS.md` 是 Windows 专用说明 | `profiles/windows/AGENTS.md` | 公共 AGENTS 与平台说明分离 |
| `extensions/pi-notify/index.ts` | `extensions/pi-notify/index.ts` | 版本化源码；不迁移 topic 文件 |
| `skills/multi-video-summarizer` | external assets lock | 固定上游 commit；检查 `config.json` 是否含本机/秘密配置 |
| `skills/show-me` | external assets lock | 固定上游 commit；不嵌套复制 `.git` |
| `auth.json` | 每机 `/login` | 禁止同步 |
| `models-store.json` | 运行时模型目录缓存 | 禁止同步 |
| `sessions/`、`run-history.jsonl` | 本机私有数据 | 禁止同步；如需备份应另建私有方案 |
| `pi-notify-topic` | 每机私有凭据 | 禁止同步，必要时由环境变量提供 |
| `npm/`、`git/`、`bin/`、`state/` | Pi 生成目录 | 由 bootstrap/Pi 重建，不同步 |
| `missions/` | 待用户单独决定 | 默认排除；如有长期内容，建议独立 private repo |

## 11. 第一版验收标准

- 一个全新的 Windows、Linux、macOS 测试环境均可执行 `plan` 和 `apply`。
- 第二次执行 `apply` 不再产生配置差异。
- 已存在的未知 `settings.json` 字段不会被删除。
- 每次改写前都有可验证 SHA-256 的备份，rollback 可恢复。
- `pi list` 能看到预期的 8 个第三方包和本仓库 package。
- 自有通知扩展与两个外部技能可被 Pi 发现。
- 未登录时 doctor 明确报告“需要 `/login`”，而不是失败或索取旧 auth 文件。
- 仓库与 Git 历史不包含 auth、API key、ntfy topic、session、cache、绝对用户目录。
- CI 至少覆盖 Ubuntu、Windows、macOS 的 JSON/manifest/merge/test/secret checks。
- README 能让没有本机上下文的人从前置安装一路完成恢复和回滚。

## 12. 实施顺序

建议按以下小步实施，避免一次把整个 `~/.pi` 倒进仓库：

1. 建立 `.gitignore`、secret scan、目录骨架与 toolchain manifest。
2. 从当前 `settings.json` 生成脱敏的 base/profile/lock 草案并人工审阅。
3. 迁移 `pi-notify`，把 topic 和平台命令继续留在本机环境。
4. 核对并固定 7 个远端 package 与 `pi-check-agent-quota` 的来源。
5. 固定两个外部技能的 commit，并检查其配置文件是否包含秘密。
6. 实现 bootstrap 的 `plan`、备份、merge、apply、doctor、rollback。
7. 在当前 Windows 机器先以临时 `PI_CODING_AGENT_DIR` 做隔离测试。
8. 再在 Linux 和 macOS 干净环境验证。
9. 验收后打第一个稳定 tag，再把它作为新机器默认恢复版本。

这份文档只确定架构和迁移边界；实际配置内容、第三方版本、脚本和 CI 应在下一阶段逐项生成并验证。
