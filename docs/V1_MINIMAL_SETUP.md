# 第一版：最小可用的 Pi 配置仓库

## 目标

第一版只解决一件事：在新电脑上通过这个仓库恢复最重要、最常用的 Pi
扩展，并提供一份可以手动执行的安装清单。

它不是 `~/.pi` 的完整备份，也不追求一条命令还原所有细节。

## 第一版包含什么

### 1. 一个 Pi Package

仓库根目录的 `package.json` 把以下本机定制扩展声明为 Pi 资源：

- `extensions/pi-notify/index.ts`：桌面通知，以及长任务的 ntfy 手机通知。
- `extensions/pi-check-agent-quota/index.ts`：当前本机使用的定制额度显示插件。

安装本仓库后，Pi 会加载这两个扩展，不需要把源码手动复制到
`~/.pi/agent/extensions`。

### 2. 一份第三方安装清单

第三方 Pi Package 不复制进本仓库。README 保存它们的 `pi install`
命令，新环境按顺序执行即可。

这样做比直接复制 `~/.pi/agent/npm` 和 `~/.pi/agent/git` 更简单，也不会把
大量可重新下载的文件提交到 Git。

### 3. 两个外部技能的安装说明

当前使用的外部技能仍由它们自己的 GitHub 仓库维护：

- `keepongo/video-summarizer`
- `xingyaoww/show-me`

第一版只在 README 中提供 clone 命令，不复制它们的嵌套 `.git` 历史。

### 4. 最小安全忽略规则

`.gitignore` 阻止常见凭据、会话、缓存和运行状态进入仓库。这不是备份或
验证系统，只是防止把明显不应该公开的文件误提交。

## 第一版明确不包含什么

- 不复制 `auth.json`，每台机器单独运行 `/login`。
- 不复制 `sessions/`、`missions/` 或运行历史。
- 不复制 `models-store.json`、缓存、`npm/`、`git/`、`bin/`、`state/`。
- 不复制完整 `settings.json`。
- 不自动设置默认模型、theme、shellPath 或 enabledModels。
- 不锁定 Pi、npm package 或外部技能版本。
- 不实现 bootstrap、备份、回滚、doctor、secret scanner 或 CI。
- 不自动区分 Windows、Linux、macOS profile。

## 为什么暂时不复制 settings.json

当前本机 `settings.json` 同时包含：

- 可以跨平台使用的 theme、默认 provider/model 和 package 列表。
- Windows 专用的 Git Bash 绝对路径。
- 可能随 provider 和 Pi 版本变化的模型列表。
- 一个只在当前电脑存在的本地 package 绝对路径。

整文件复制到 Linux 或 macOS 会带入错误路径。第一版选择在 README 中记录
关键偏好，让用户在新机器上手动选择；等手动恢复流程稳定后，再考虑自动
合并设置。

## 当前迁移内容

| 本机内容 | 第一版处理 |
| --- | --- |
| `pi-notify` | 已复制进本仓库 Pi Package |
| 本地定制 `pi-check-agent-quota 0.1.2-gpt.2` | 已复制并保留上游许可证和差异说明 |
| 其他第三方 Pi Packages | README 中保存无版本号安装命令 |
| `multi-video-summarizer`、`show-me` | README 中保存 Git clone 命令 |
| theme `dark`、默认 `kimi-coding/k3-256k` | README 中记录，登录后手动设置 |
| Windows Git Bash/WSL 说明 | README 中记录为 Windows 可选步骤 |
| 认证、会话、缓存和通知 topic | 不上传 |

## 使用入口

新环境的完整手动步骤见仓库根目录的 [`README.md`](../README.md)。
