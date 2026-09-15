---
name: herdr-subagent
description: 用 Herdr 发车、轮询、验收和回收子代理的精简 SOP。触发：检查 Herdr/子代理条件、Wayfinder research 票、用户要求并行或后台任务、排查 Herdr 调用失败。
---

# Herdr 子代理闭环 SOP（Windows + Herdr 0.9.0）

## 0. 核心原则

**子代理不会自动向当前聊天回传，也不会自动唤醒普通主代理会话。** Herdr 只更新状态。

主代理必须负责完整闭环：

> 判断是否分派 → 登记任务 → 创建并启动 → 确认开跑 → 主动轮询 → 处理异常 → 验收产物 → 反馈用户 → 经同意后回收

硬规则：

1. `prompt` 成功仅表示已投递，`working` 仅表示已开跑。
2. `idle/done` 仅表示可接收输入；读取输出并验收后才算完成。
3. 结束回复前必须轮询全部在途代理。
4. 若跨回合仍在运行，明确告知用户“不会自动反馈，下回合需主动轮询”。
5. 子代理提供证据；最终判断、冲突消解和用户反馈由主代理负责。
6. 只控制自己创建并记录的 pane/agent。
7. 是否分派、并发数、轮询间隔和验收深度由当次主代理判断。

## 1. 环境检查

不要在 WSL bash 中用 `$HERDR_ENV` 判断：Windows 进程变量默认不透传，容易假阴性。

优先：

```text
herdr tool: subcommand "status"
```

备选：`cmd.exe /c "set HERDR"`、`cmd.exe /c "where herdr"`。

怀疑 CLI 版本差异时，用 `herdr agent`、`herdr pane` 查看当前帮助；安装的 CLI 是权威。

## 2. 分派前登记

主代理至少记录：

- agent name 与 pane ID；
- 唯一子任务、输入范围；
- 允许/禁止修改范围；
- 输出路径与完成标准；
- 当前状态和 pane 归属。

适合分派：独立、耗时、可并行、可验收的研究/测试/审计任务。

不适合分派：几分钟可完成、需要用户实时决策、会并发写同一文件、完成标准含糊或主代理无法验收的任务。

## 3. 发车

### 3.1 创建 pane

```text
subcommand: "pane split"
args: { "current": true, "direction": "right", "cwd": "<绝对路径>", "no-focus": true }
```

宽屏向右，窄/高向下；读取 `.result.pane.pane_id`。不要切出不可用的小 pane。

### 3.2 启动 agent

```text
subcommand: "agent start <name>"
args: { "kind": "pi", "pane": "<pane-id>", "timeout": 60000 }
```

名称匹配 `[a-z][a-z0-9_-]{0,31}` 且唯一。成功标准：`idle` + `interactive_ready: true`。若 `blocked/unknown`，先 read，不要投递。

### 3.3 投递任务书

Herdr 工具会按空格拆 `subcommand`；正文是位置参数：

- 不要把正文放进 `args`；
- 不要直接拼入含空格正文；
- 使用无空格的中文单 token 任务书。

```text
subcommand: "agent prompt audit-x 你是研究子代理,只做X。先读A和B。只读检查C。报告写到research/x.md。必须包含证据与未验证项。不得修改源码。完成后停在idle,不要退出。"
```

任务书必须写清：唯一任务、输入、权限、输出、完成标准、语言和收尾状态。

长任务不在 `prompt` 上等待完成；工具层上限约 120 秒，timeout 不代表未投递。

### 3.4 确认开跑

```text
subcommand: "agent wait <name>"
args: { "until": "working", "timeout": 30000 }
```

未进入 `working` 时依次 `get`、`read`；不要盲目重复 prompt。

## 4. 主动轮询

必须在以下节点轮询：

1. 投递后确认 `working`；
2. 主代理完成一段独立工作后；
3. 准备发送阶段性或结束回复前；
4. 用户回来询问完成情况时，第一动作就是批量 `get` + 检查输出目录。

```text
状态: agent get <name>
等待: agent wait <name> --timeout 110000
输出: agent read <name> --source recent-unwrapped --lines 120
```

多代理先并行 `get`，只对状态变化或异常者 `read`。轮询频率由主代理按预计任务时长决定。

| 状态 | 主代理动作 |
|---|---|
| `working` | 记录并稍后再查 |
| `blocked` | read；涉及权限、费用、破坏性操作或用户决策时询问用户 |
| `idle/done` | read + 验收约定产物 |
| `unknown` | read，必要时查 pane/process；不可推断完成 |
| timeout/stalled | get/read 后判断；禁止直接重投 |

## 5. 跨回合规则

若回复结束时仍有代理工作，必须告诉用户：

- 哪些代理仍在运行；
- 产物会写到哪里；
- 不会自动回传；
- 下一回合首先主动轮询。

禁止承诺“完成后自动通知”。

## 6. 完成验收

`idle/done` 后逐项检查：

1. 读取结尾输出，确认不是部分完成或遗留提问；
2. 检查文件存在、可读、路径正确；
3. 对照完成标准，抽查关键证据、测试和来源；
4. 检查 git diff/status、敏感信息、越权修改、遗留进程；
5. 多代理结果去重、消歧，冲突由主代理复核；
6. 立即向用户反馈状态、结论、路径、风险和下一决策。

不合格时，可让同一代理做一次聚焦补充；是否补派或主代理接手由主代理判断。

## 7. 中断与回收

### 中断

只中断自己启动的 agent。先 read；确认任务失效或越界后，可发 `esc`/`ctrl+c`，随后 get/read 验证。timeout 本身不是中断理由。

### 保留

研究完成后默认停在 `idle`，等主代理验收和可能补问；验收前不关 pane。

### 回收

- 关闭本会话创建的 pane 前也必须征得用户同意；
- 关闭前确认 agent 已 `idle/done`、产物已落盘、无需保留进程；
- 不关闭用户或其他会话创建的 pane/tab/workspace；
- `server stop` 不是清理方式，必须有用户明确确认。

## 8. 收尾检查

- [ ] 全部在途 agent 已主动 get；
- [ ] idle/done 已 read 并验收产物；
- [ ] blocked/unknown/timeout 已处理；
- [ ] 结果已由主代理整合并反馈用户；
- [ ] 若仍运行，已说明不会自动回传；
- [ ] 回收前已确认资源归属并获得同意。

**子代理负责并行劳动，主代理负责闭环。**
