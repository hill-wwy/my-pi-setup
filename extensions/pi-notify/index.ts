/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Supports multiple terminal protocols:
 * - OSC 777: Ghostty, WezTerm, rxvt-unicode
 * - OSC 9: iTerm2
 * - OSC 99: Kitty
 * - tmux passthrough wrapper for OSC notifications
 * - Windows toast: Windows Terminal (WSL)
 * - Optional sound hook via PI_NOTIFY_SOUND_CMD
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function psEscape(s: string): string {
    return s.replace(/'/g, "''");
}

function windowsToastScript(title: string, body: string): string {
    const t = psEscape(title);
    const b = psEscape(body);
    const type = "Windows.UI.Notifications";
    const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
    const template = `[${type}.ToastTemplateType]::ToastText02`;
    const toast = `[${type}.ToastNotification]::new($xml)`;
    return [
        `${mgr} > $null`,
        `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
        `$xml.GetElementsByTagName('text').Item(0).AppendChild($xml.CreateTextNode('${t}')) > $null`,
        `$xml.GetElementsByTagName('text').Item(1).AppendChild($xml.CreateTextNode('${b}')) > $null`,
        `[${type}.ToastNotificationManager]::CreateToastNotifier('Pi').Show(${toast})`,
    ].join("; ");
}

function wrapForTmux(sequence: string): string {
    if (!process.env.TMUX) return sequence;

    // tmux passthrough: wrap in DCS and escape inner ESC bytes.
    const escaped = sequence.split("\x1b").join("\x1b\x1b");
    return `\x1bPtmux;${escaped}\x1b\\`;
}

function notifyOSC777(title: string, body: string): void {
    const sequence = `\x1b]777;notify;${title};${body}\x07`;
    process.stdout.write(wrapForTmux(sequence));
}

function notifyOSC9(message: string): void {
    const sequence = `\x1b]9;${message}\x07`;
    process.stdout.write(wrapForTmux(sequence));
}

function notifyOSC99(title: string, body: string): void {
    // Kitty OSC 99: i=notification id, d=0 means not done yet, p=body for second part
    const titleSequence = `\x1b]99;i=1:d=0;${title}\x1b\\`;
    const bodySequence = `\x1b]99;i=1:p=body;${body}\x1b\\`;
    process.stdout.write(wrapForTmux(titleSequence));
    process.stdout.write(wrapForTmux(bodySequence));
}

function notifyWindows(title: string, body: string): void {
    const { execFile } = require("node:child_process");
    execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
}

function runSoundHook(): void {
    const command = process.env.PI_NOTIFY_SOUND_CMD?.trim();
    if (!command) return;

    try {
        const { spawn } = require("node:child_process");
        const child = spawn(command, {
            shell: true,
            detached: true,
            stdio: "ignore",
        });
        child.unref();
    } catch {
        // Ignore hook errors to avoid breaking notifications
    }
}

function notify(title: string, body: string): void {
    const isIterm2 = process.env.TERM_PROGRAM === "iTerm.app" || Boolean(process.env.ITERM_SESSION_ID);

    if (process.env.WT_SESSION) {
        notifyWindows(title, body);
    } else if (process.env.KITTY_WINDOW_ID) {
        notifyOSC99(title, body);
    } else if (isIterm2) {
        notifyOSC9(`${title}: ${body}`);
    } else {
        notifyOSC777(title, body);
    }

    runSoundHook();
}

// Runtime toggle, controllable per-session via /notify on|off|toggle|status.
// Initial state can be preset with the PI_NOTIFY_OFF environment variable.
let notifyEnabled = !process.env.PI_NOTIFY_OFF;

// --- ntfy (phone push) ---
// Topic resolution order: PI_NOTIFY_NTFY_TOPIC env > persisted random topic file.
// Server defaults to https://ntfy.sh, override with PI_NOTIFY_NTFY_SERVER.
function resolveNtfyTopic(): string {
    const envTopic = process.env.PI_NOTIFY_NTFY_TOPIC?.trim();
    if (envTopic) return envTopic;
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const file = path.join(os.homedir(), ".pi", "agent", "pi-notify-topic");
    try {
        const existing = fs.readFileSync(file, "utf8").trim();
        if (existing) return existing;
    } catch {
        // No topic file yet — generate one below.
    }
    const topic = `pi-${require("node:crypto").randomBytes(12).toString("hex")}`;
    try {
        fs.writeFileSync(file, topic + "\n", { mode: 0o600 });
    } catch {
        // Read-only home dir — topic will regenerate each run.
    }
    return topic;
}

const ntfyTopic = resolveNtfyTopic();
const ntfyServer = (process.env.PI_NOTIFY_NTFY_SERVER ?? "https://ntfy.sh").replace(/\/+$/, "");
// Only push to phone for tasks longer than this (seconds, default 10 min).
const ntfyMinDurationMs = (Number(process.env.PI_NOTIFY_NTFY_MIN_DURATION) || 600) * 1000;

// ntfy headers must be ASCII; encode non-ASCII titles per RFC 2047.
function encodeHeaderValue(s: string): string {
    return /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

async function notifyNtfy(title: string, body: string, status: string): Promise<void> {
    const tags = status === "Done" ? "white_check_mark" : status === "Failed" ? "x" : "warning";
    const priority = status === "Failed" ? "4" : "3";
    const encodedTitle = encodeHeaderValue(title);

    // Try fetch twice, then fall back to curl (node fetch can hit IPv6/timeout issues).
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            await fetch(`${ntfyServer}/${ntfyTopic}`, {
                method: "POST",
                headers: { Title: encodedTitle, Tags: tags, Priority: priority },
                body,
                signal: controller.signal,
            });
            clearTimeout(timer);
            return;
        } catch {
            // Retry once, then fall back to curl.
        }
    }
    try {
        // Write body to a temp file to guarantee UTF-8 bytes (Windows argv encoding is unreliable).
        const fs = require("node:fs");
        const path = require("node:path");
        const os = require("node:os");
        const tmp = path.join(os.tmpdir(), `pi-notify-${process.pid}-${Date.now()}.txt`);
        fs.writeFileSync(tmp, body, "utf8");
        const { execFile } = require("node:child_process");
        execFile(
            "curl.exe",
            [
                "-sS", "-m", "15", "-X", "POST", `${ntfyServer}/${ntfyTopic}`,
                "-H", `Title: ${encodedTitle}`,
                "-H", `Tags: ${tags}`,
                "-H", `Priority: ${priority}`,
                "-H", "Content-Type: text/plain; charset=utf-8",
                "--data-binary", `@${tmp}`,
            ],
            () => {
                try { fs.unlinkSync(tmp); } catch {}
            },
        );
    } catch {
        // Give up silently — never break the agent loop for a notification.
    }
}

function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
}

// Accumulated across low-level runs (retries/compactions) of one task.
let runStart = 0;
let status = "Done";

export default function (pi: ExtensionAPI) {
    // Subagent child processes (pi-subagents) run with PI_SUBAGENT_CHILD=1.
    // They report back to the parent agent — never notify the human for them.
    if (process.env.PI_SUBAGENT_CHILD) return;

    pi.registerCommand("notify", {
        description: "Toggle notifications and show current config",
        getArgumentCompletions: (prefix: string) => {
            const items = ["on", "off"].map((v) => ({ value: v, label: v }));
            const filtered = items.filter((i) => i.value.startsWith(prefix ?? ""));
            return filtered.length > 0 ? filtered : null;
        },
        handler: async (args, ctx) => {
            const arg = args?.trim().toLowerCase();
            if (arg === "on") notifyEnabled = true;
            else if (arg === "off") notifyEnabled = false;
            else notifyEnabled = !notifyEnabled; // bare /notify (or anything else) toggles
            const lines = [
                `pi-notify 当前配置`,
                `开关: ${notifyEnabled ? "ON" : "OFF"}`,
                `触发: 主会话任务彻底结束且空闲时（agent_settled）；子代理不通知`,
                `桌面 toast: 总是发送`,
                `手机 ntfy: 仅任务耗时 ≥ ${ntfyMinDurationMs / 1000}s`,
            ];
            ctx.ui.notify(lines.join("\n"), "info");
        },
    });

    pi.on("agent_start", async () => {
        if (!runStart) runStart = Date.now();
    });

    pi.on("agent_end", async (event) => {
        const msgs = (event.messages ?? []).filter((m: any) => m.role === "assistant");
        const last: any = msgs[msgs.length - 1];
        if (last) {
            if (last.stopReason === "error") status = "Failed";
            else if (last.stopReason === "aborted") status = "Aborted";
            else status = "Done";
        }
    });

    // agent_settled: no retry/compaction/follow-up left — the task truly finished.
    pi.on("agent_settled", async (_event, ctx) => {
        if (!notifyEnabled) return;
        // Another run is already going (e.g. follow-up queued, or an in-process
        // foreground subagent ended while the main agent continues) — skip.
        if (!ctx.isIdle()) return;

        const folder = ctx.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? ctx.cwd;
        const name = pi.getSessionName() ?? folder;

        let branch = "";
        try {
            const r = await pi.exec("git", ["branch", "--show-current"], { timeout: 3000 });
            if (r.code === 0) branch = r.stdout.trim();
        } catch {
            // Not a git repo or git unavailable — skip branch.
        }

        const now = new Date();
        const hhmm = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
        const durationMs = runStart ? Date.now() - runStart : 0;
        const duration = runStart ? formatDuration(durationMs) : "";

        const line1 = [status, hhmm, duration].filter(Boolean).join(" · ");
        const line2 = `..\\${folder}` + (branch ? ` ⎇ ${branch}` : "");
        const body = `${line1}  ${line2}`;
        notify(name, body);
        // Phone push only for long tasks (default ≥ 10 min); desktop toast always fires.
        if (durationMs >= ntfyMinDurationMs) {
            void notifyNtfy(name, body, status);
        }

        runStart = 0;
        status = "Done";
    });
}
