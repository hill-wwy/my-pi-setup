# 后续功能：需要时再增加

这份文档记录第一版刻意不实现的能力。它们不是当前安装流程的依赖。

## 1. 固定版本和提交

未来可以记录：

- Pi 的精确版本。
- 每个 npm package 的精确版本。
- 每个 Git package 或外部 skill 的 commit。

作用是让不同机器恢复到完全相同的状态。但第一版优先追求简单，默认安装
当时的最新版本。

适合引入的时机：某次更新导致功能改变，或者不同机器开始出现行为差异。

## 2. 平台配置层

未来可以把设置拆成：

```text
公共设置
+ Windows 设置
+ Linux 设置
+ macOS 设置
+ 每台机器自己的私有覆盖
```

它主要解决 `shellPath`、external editor、通知命令和全局 AGENTS 指令在不同
系统上不一样的问题。

第一版不复制 `settings.json`，所以暂时不需要这层设计。

适合引入的时机：已经在两种以上操作系统上手动恢复，并明确知道哪些字段
确实需要共享。

## 3. Bootstrap

Bootstrap 是自动执行安装 Pi、安装 packages、复制或合并设置的一段程序。

它只能减少重复操作，不能替代先把人工流程弄清楚。第一版的操作仍很短，
README 比自动化脚本更容易理解和修改。

适合引入的时机：README 的人工步骤已经稳定，而且重复安装开始让人厌烦。

## 4. 备份与回滚

当未来脚本开始自动修改 `~/.pi/agent/settings.json` 时，才需要在写入前备份，
并提供恢复旧文件的方式。

第一版只通过 Pi 自己的安装命令增加 packages，不覆盖完整配置，因此不实现
额外备份系统。

## 5. 自动验证和 CI

未来可以检查：

- `package.json` 和配置 JSON 是否有效。
- Pi 是否能加载所有资源。
- Windows、Linux、macOS 是否都能执行安装流程。
- 仓库是否意外包含密钥或会话文件。

第一版只做人工使用检查，不建立测试矩阵或 GitHub Actions。

## 6. 自动同步 settings.json

未来可以只合并允许管理的字段，例如 theme、默认模型和 enabledModels，同时
保留 Pi 写入的其他字段。

不应直接覆盖整个文件，因为当前配置包含 Windows 绝对路径和本机 package
路径。

## 7. npm 发布与自动升级

目前直接通过 GitHub 安装本仓库已经足够：

```bash
pi install https://github.com/hill-wwy/my-pi-setup
```

只有当这个仓库需要被其他人广泛安装时，才值得发布 npm package。每日自动
升级依赖也应等到有跨平台测试后再考虑。

## 参考仓库如何影响后续设计

- [`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff)：Pi Package
  的资源组织方式。
- [`bestony/bestony-pi`](https://github.com/bestony/bestony-pi)：依赖聚合、lockfile
  与发布自动化，留作后续参考。
- [`cad0p/pi-config`](https://github.com/cad0p/pi-config)：完整配置恢复、忽略规则和
  复杂 settings 的参考，但不直接把仓库放到 `~/.pi`。
- [`Jaxton07/percho`](https://github.com/Jaxton07/percho)：CLI/GUI 共用
  `~/.pi/agent`、环境变量凭据和跨平台 PATH 的参考。
