# my-pi-setup

我的最小 Pi 环境恢复仓库。

当前第一版只做两件事：

- 通过一个 Pi Package 安装本机定制的 `pi-notify` 和
  `pi-check-agent-quota` 扩展。
- 记录其他第三方 packages、外部 skills 和基础偏好的手动恢复步骤。

本仓库不会同步登录凭据、聊天会话、缓存或完整 `settings.json`。

## 新环境安装

以下步骤适用于 Windows、Linux 和 macOS。系统需要先安装：

- [Git](https://git-scm.com/)
- Node.js `>=22.19.0`
- npm

### 1. 安装 Pi

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version
```

### 2. 安装本仓库 Pi Package

```bash
pi install https://github.com/hill-wwy/my-pi-setup
```

这一步会加载：

- `pi-notify`：任务完成时发送终端/桌面通知；长任务可以发送 ntfy 手机通知。
- `pi-check-agent-quota`：显示 provider 额度；仓库保存的是当前本机的定制版本，
  包含 OpenAI Codex 用量窗口和 Windows IPv4 兼容处理。

### 3. 安装当前使用的第三方 Pi Packages

逐条执行：

```bash
pi install npm:pi-web-access
pi install npm:@plannotator/pi-extension
pi install npm:@narumitw/pi-goal
pi install npm:@narumitw/pi-btw
pi install npm:pi-codex-fast-mode
pi install git:github.com/majorgilles/pi-grill-me
```

当前电脑还安装了 `pi-subagents`，但它的主扩展和两个 skills 都已禁用，所以
第一版默认不安装。需要它时可以执行：

```bash
pi install npm:pi-subagents
pi config
```

使用 `pi config` 可以检查和启用/禁用各 package 提供的具体资源。

### 4. 安装两个外部 Skills

#### Windows PowerShell

```powershell
$piSkillsDir = Join-Path $HOME ".pi\agent\skills"
New-Item -ItemType Directory -Force -Path $piSkillsDir | Out-Null
git clone https://github.com/keepongo/video-summarizer.git (Join-Path $piSkillsDir "multi-video-summarizer")
git clone https://github.com/xingyaoww/show-me.git (Join-Path $piSkillsDir "show-me")
```

#### Linux / macOS

```bash
mkdir -p ~/.pi/agent/skills
git clone https://github.com/keepongo/video-summarizer.git ~/.pi/agent/skills/multi-video-summarizer
git clone https://github.com/xingyaoww/show-me.git ~/.pi/agent/skills/show-me
```

`multi-video-summarizer` 还可能需要 Python 依赖；第一次使用前按它自己的
README 安装即可。

### 5. 登录并恢复基础偏好

启动 Pi：

```bash
pi
```

在 Pi 中执行：

```text
/login
/settings
/model
```

当前常用偏好：

| 项目 | 当前值 |
| --- | --- |
| Theme | `dark` |
| 默认 provider | `kimi-coding` |
| 默认 model | `k3-256k` |

如果使用 ChatGPT/Codex 登录，并希望启用 Fast mode：

```text
/fast on
/fast status
```

### 6. Windows 可选环境说明

当前 Windows 环境使用原生 Git Bash，不是 WSL。需要时可创建
`~/.pi/agent/AGENTS.md`：

```markdown
# 环境（Windows）

bash 工具是 Git Bash（Windows 原生，非 WSL）。需要 Linux 环境时：
`wsl -d Ubuntu`。
```

Linux 和 macOS 不要复制这段 Windows 指令。

## 简单检查

查看已经安装的 packages：

```bash
pi list
```

进入 Pi 后可以检查定制扩展：

```text
/notify on
/checkaq
```

如果某个资源没有加载，运行：

```bash
pi config
```

## 更新

第一版不锁定版本。需要更新 Pi 和已安装 packages 时手动执行：

```bash
pi update --all
```

## 不要上传这些内容

不要把下面的本机文件复制进本仓库：

- `~/.pi/agent/auth.json`
- `~/.pi/agent/sessions/`
- `~/.pi/agent/models-store.json`
- `~/.pi/agent/run-history.jsonl`
- `~/.pi/agent/pi-notify-topic`
- `~/.pi/agent/npm/`、`git/`、`bin/`、`state/`

每台机器都应单独执行 `/login`。API key 应放在环境变量或 Pi 的本机认证
存储中，不要提交到 Git。

## 设计文档

- [第一版：最小可用方案](docs/V1_MINIMAL_SETUP.md)
- [后续功能：需要时再增加](docs/FUTURE_FEATURES.md)
