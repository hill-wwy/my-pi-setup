# my-pi-setup

我的 Pi 环境恢复仓库。**以当前 Windows 机器为唯一事实来源**，仓库文件
镜像 `~/.pi/agent/` 的真实布局，新机器上按位置复制回去即可。

本仓库**不再是一个 Pi Package**（当前机器已经不用 `pi install <本仓库>`
的方式加载扩展），而是一个纯粹的"定制文件 + 恢复清单"仓库。

不会同步登录凭据、聊天会话、缓存或完整 `settings.json`。

## 仓库内容 → 安装位置

| 仓库路径 | 恢复到 | 说明 |
| --- | --- | --- |
| `extensions/pi-notify/` | `~/.pi/agent/extensions/pi-notify/` | 桌面/终端通知，长任务可发 ntfy 手机通知 |
| `extensions/tokenhub-gateway/` | `~/.pi/agent/extensions/tokenhub-gateway/` | 腾讯 TokenHub 聚合网关（`gateway.mjs` + `config.json`；`index.ts.disabled` 是可选的 pi 自启动扩展，当前**已禁用**） |
| `local-packages/pi-check-agent-quota/` | `~/.pi/agent/local-packages/` | 本机定制额度显示 local package（zai-coding 国内外通用、reset 倒计时等） |
| `models.json` | `~/.pi/agent/models.json` | 自定义 provider `tencent-tokenhub`（指向本机网关 `127.0.0.1:8790/v1`，含 `auto` 故障转移链） |
| `AGENTS.md` | `~/.pi/agent/AGENTS.md` | 全局 agent 环境规则（WSL2 路径约定、共用浏览器守护 8787） |
| `skills/herdr-subagent/` | `~/.pi/agent/skills/herdr-subagent/` | 自制中文版 Herdr 子代理 SOP（与 @sfroment/pi-herdr 自带 skill 不同） |

## 新环境恢复步骤

系统需要：[Git](https://git-scm.com/)、Node.js `>=22.19.0`、npm。

### 1. 安装 Pi

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version
```

### 2. 复制定制文件

bash（Git Bash / WSL 均可，`$HOME` 换成对应用户目录）：

```bash
PI="$HOME/.pi/agent"
mkdir -p "$PI/extensions" "$PI/local-packages" "$PI/skills"

cp -r extensions/pi-notify               "$PI/extensions/"
cp -r extensions/tokenhub-gateway        "$PI/extensions/"
cp -r local-packages/pi-check-agent-quota "$PI/local-packages/"
cp models.json                           "$PI/models.json"
cp AGENTS.md                             "$PI/AGENTS.md"
cp -r skills/herdr-subagent              "$PI/skills/"
```

PowerShell：

```powershell
$pi = "$HOME\.pi\agent"
Copy-Item -Recurse -Force extensions\pi-notify                "$pi\extensions\"
Copy-Item -Recurse -Force extensions\tokenhub-gateway         "$pi\extensions\"
Copy-Item -Recurse -Force local-packages\pi-check-agent-quota "$pi\local-packages\"
Copy-Item -Force models.json  "$pi\models.json"
Copy-Item -Force AGENTS.md    "$pi\AGENTS.md"
Copy-Item -Recurse -Force skills\herdr-subagent "$pi\skills\"
```

### 3. 安装第三方 Pi Packages

当前机器实际安装列表：

```bash
pi install npm:pi-web-access
pi install npm:@plannotator/pi-extension
pi install npm:@narumitw/pi-goal
pi install npm:@narumitw/pi-btw
pi install npm:pi-codex-fast-mode
pi install git:github.com/majorgilles/pi-grill-me
pi install npm:@sfroment/pi-herdr
pi install npm:pi-compact-ui
```

可选（当前机器装了但资源已禁用，恢复后用 `pi config` 按需开关）：

```bash
pi install npm:pi-subagents   # 本机已禁用：主扩展 + 全部 skills + 全部 prompts
pi install npm:pi-x-search    # 本机已禁用：extensions/x-search.ts
```

当前各 package 的启用细节（对照 `pi config` 检查）：

- `@narumitw/pi-goal`：仅 `+dist/index.ts` 启用。
- `@narumitw/pi-btw`：扩展 `-dist/index.ts` 禁用（只用它的 prompts/skills）。
- `pi-check-agent-quota` 不走 `pi install`，是 local package（步骤 2 已复制），
  settings.json 里表现为路径 `~/.pi/agent/local-packages/pi-check-agent-quota`。

### 4. 安装外部 Skills

**Git clone（保持可 git pull 更新）：**

```bash
PI="$HOME/.pi/agent/skills"; mkdir -p "$PI"
git clone https://github.com/keepongo/video-summarizer.git "$PI/multi-video-summarizer"
git clone https://github.com/xingyaoww/show-me.git          "$PI/show-me"
git clone https://github.com/badlogic/pi-skills.git         "$PI/pi-skills"   # 用其中的 browser-tools
```

**从 mattpocock/skills 复制（纯拷贝，更新时重新复制即可）：**

```bash
git clone --depth 1 https://github.com/mattpocock/skills.git /tmp/mp-skills
PI="$HOME/.pi/agent/skills"
cp -r /tmp/mp-skills/skills/productivity/grill-me  /tmp/mp-skills/skills/productivity/grilling \
      /tmp/mp-skills/skills/productivity/handoff   /tmp/mp-skills/skills/productivity/teach \
      "$PI/"
cp -r /tmp/mp-skills/skills/engineering/implement /tmp/mp-skills/skills/engineering/prototype \
      /tmp/mp-skills/skills/engineering/research  /tmp/mp-skills/skills/engineering/tdd \
      /tmp/mp-skills/skills/engineering/to-spec   /tmp/mp-skills/skills/engineering/to-tickets \
      /tmp/mp-skills/skills/engineering/wayfinder "$PI/"
```

自制 skill（`herdr-subagent`）已在本仓库 `skills/` 里，步骤 2 复制。

### 5. 登录

在 Pi 中逐个执行 `/login`：

- `zai-coding-cn`（GLM Coding Plan，默认 provider）
- `openai-codex`（ChatGPT 登录，可选 `/fast on` 开 Fast mode）
- `deepseek`
- `tencent-tokenhub`：粘贴 TokenHub API key。key 保存在 `auth.json`，
  TokenHub 网关运行时会读它（也可用环境变量 `TENCENT_TOKENHUB_API_KEY` 代替）。

### 6. 基础偏好

| 项目 | 当前值 |
| --- | --- |
| Theme | `dark` |
| 默认 provider | `zai-coding-cn` |
| 默认 model | `glm-5.3-flash` |
| enabledModels | `openai-codex/gpt-5.6-terra`、`openai-codex/gpt-5.6-sol`、`deepseek/deepseek-flash`、`zai-coding-cn/glm-5.3-flash`、`zai-coding-cn/glm-5.3`、`zai-coding-cn/glm-4.6v`（在 `/model` 里勾选） |
| `web-search.json` | `{"workflow": "auto-summary"}` |
| `config/thinking-box.json` | `{"showHeader": false}` |

### 7. TokenHub 聚合网关

`extensions/tokenhub-gateway/gateway.mjs`（零依赖，纯 node 内置模块）把腾讯
TokenHub 上的 17 个模型合成一个虚拟模型 `auto`：按 `config.json` 的 chain
顺序依次尝试，额度用尽/限流自动切换下一个，用尽的写进 `state.json` 冷却。
pi 通过 `models.json` 里的 `tencent-tokenhub` provider 走 `http://127.0.0.1:8790/v1`。

启动（后台常驻，pi 退出不杀）：

```bash
node ~/.pi/agent/extensions/tokenhub-gateway/gateway.mjs &
```

Windows 常驻可在 PowerShell 里 `Start-Process node -ArgumentList "...gateway.mjs" -WindowStyle Hidden`。
端口 8790 已被占用时新实例会自动退出（说明已在运行）。

让 pi 每次会话自动拉起网关：把 `index.ts.disabled` 改名为 `index.ts`
（当前机器该自启动扩展处于**禁用**状态，手动启动）。

## 日常更新

```bash
pi update --all          # 更新 pi 与已装 packages
```

Windows 机器上有变更后，把新状态同步回本仓库：对比 `~/.pi/agent/` 与仓库
对应文件，改了就覆盖进来提交（以 Windows 为准，仓库里多余的就删掉）。

## 不要上传这些内容

- `auth.json`（及 `.bak`）、`sessions/`、`missions/`、`run-history.jsonl`、`pi-notify-topic`
- `models-store.json`、`state/`、`web-search-cache/`、`npm/`、`git/`、`bin/`
- `extensions/herdr-agent-state.ts`（herdr 自动生成、自动覆盖）
- `extensions/tokenhub-gateway/state.json`、`gateway.log`（运行时产物，已在 .gitignore）

以上均已被 `.gitignore` 拦截；每台机器单独 `/login`。

## 设计文档

- [后续功能：需要时再增加](docs/FUTURE_FEATURES.md)
