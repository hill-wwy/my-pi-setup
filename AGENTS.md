# 环境(Windows 主机)

bash 运行在 **WSL2 Ubuntu 24.04** ,root 用户;不是 Git Bash,无需再 `wsl -d` 进入 Linux。
- 路径一律用挂载形式 `/mnt/d/...`、`/mnt/c/...`;写 `D:/...` 会失败。
- 调 Windows 程序用互操作(已在 PATH):`cmd.exe /c ...`、`powershell.exe ...`、`reg.exe ...`。
- bash 内的 node/python 等是 Linux 侧版本;发行版虚拟磁盘在 `D:\WSL\distro`,勿动勿删。

# 浏览器(多 agent 共用,硬规矩)

读浏览器一律先走常驻守护 `curl http://127.0.0.1:8787/*`(tabs/read/eval/ping),多个 agent 并发共用它,不要各自另起连接。
- 请求失败时:先 `curl -s http://127.0.0.1:8787/ping` 自检一次;ping 正常说明是路由/参数错,ping 失败说明 Chrome 没开或调试开关没勾。
- 自检失败只向用户报告**一次**「daemon 不通,请检查 Chrome 是否开着、chrome://inspect/#remote-debugging 是否勾选」,勾选后 daemon 会自动重连。禁止反复追问,禁止擅自跑 browser-start.js(会另开一个独立 profile 的 Chrome,读不到日用标签页)。
- CLI 脚本(browser-eval.js 等)仅作应急兑底,不作为常规入口。

