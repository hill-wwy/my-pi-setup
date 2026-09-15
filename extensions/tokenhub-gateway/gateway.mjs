#!/usr/bin/env node
/**
 * TokenHub 聚合网关
 *
 * 把腾讯云 TokenHub 上的多个模型合成一个虚拟模型 `auto`：
 *   - 请求 model="auto" 时，按 config.chain 顺序依次尝试
 *   - 遇额度用尽 / 限流 / 模型不可用 → 自动换下一个，对调用方完全透明
 *   - 用尽的模型写入 state.json，冷却期内跳过
 *
 * 对上游：https://tokenhub.tencentmaas.com/v1   (OpenAI 兼容)
 * 对下游：http://127.0.0.1:<port>/v1            (OpenAI 兼容)
 *
 * 零依赖，仅用 node 内置模块。
 */

import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CFG_PATH = path.join(DIR, 'config.json')
const STATE_PATH = path.join(DIR, 'state.json')
const LOG_PATH = path.join(DIR, 'gateway.log')

const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))
const upstreamUrl = new URL(cfg.upstream)
const UPSTREAM_HOST = upstreamUrl.hostname
const UPSTREAM_PORT = upstreamUrl.port ? Number(upstreamUrl.port) : 443

// ---------------------------------------------------------------- 状态

let state = { exhausted: {}, hard: {}, fails: {}, preferred: [] }
try {
  if (fs.existsSync(STATE_PATH)) state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
} catch { /* 损坏就从零开始 */ }
state.exhausted ??= {}
state.hard ??= {}
state.fails ??= {}
state.preferred ??= []

const saveState = () => {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)) } catch { /* ignore */ }
}

const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`
  try { fs.appendFileSync(LOG_PATH, line + '\n') } catch { /* ignore */ }
  if (!cfg.quiet) console.log(line)
}

const cooldownMs = (cfg.exhaustCooldownMinutes ?? 360) * 60_000
const hardCooldownMs = (cfg.hardExhaustCooldownMinutes ?? 10080) * 60_000
const backoffCapMs = (cfg.backoffCapMinutes ?? 1440) * 60_000

/** 单个模型本次该冷却多久：硬耗尽 → 超长冷却；软耗尽 → 6h 起步、按失败次数指数退避 */
function cooldownFor(model) {
  if (state.hard[model]) return hardCooldownMs
  const n = state.fails[model] ?? 1
  return Math.min(cooldownMs * Math.pow(2, Math.max(0, n - 1)), backoffCapMs)
}

function isCooling(model) {
  const t = state.exhausted[model]
  if (!t) return false
  return Date.now() - t < cooldownFor(model)
}

/** 可选链：先按“最近成功优先”，再按配置顺序；
 *  - 硬耗尽（免费额度用尽/未开按量）**永远不再丢回池子**（除非 tryHardWhenNothingLeft）
 *  - 软冷却到期即恢复
 *  - 池子空了就返回空数组 → 上层直接快速 503，避免逐候选磨蹭 7 分钟 */
function availableChain() {
  const pref = state.preferred.filter((m) => cfg.chain.includes(m))
  const rest = cfg.chain.filter((m) => !pref.includes(m))
  const ordered = [...pref, ...rest]
  const fresh = ordered.filter((m) => !state.hard[m] && !isCooling(m))
  if (fresh.length) return fresh
  if (cfg.tryHardWhenNothingLeft) return ordered.filter((m) => !isCooling(m)).concat(ordered.filter(isCooling))
  return []
}

/** 标记模型不可用；hard=true 表示“免费额度/未开按量”这种不会自愈的情况 */
function markExhausted(model, { hard = false, reason = '' } = {}) {
  state.exhausted[model] = Date.now()
  state.fails[model] = (state.fails[model] ?? 0) + 1
  if (hard) state.hard[model] = Date.now()
  const mins = Math.round(cooldownFor(model) / 60000)
  saveState()
  log(`EXHAUST ${model}${hard ? ' (HARD)' : ''} 冷却 ${mins} 分钟${reason ? ` :: ${reason}` : ''}`)
}

/** 成功 → 把该模型提到优先队列前面，并清掉它的失败计数 */
function recordSuccess(model) {
  state.fails[model] = 0
  state.exhausted[model] = undefined
  delete state.exhausted[model]
  if (state.hard[model]) delete state.hard[model]
  state.preferred = [model, ...state.preferred.filter((m) => m !== model)].slice(0, 6)
  saveState()
}

// ---------------------------------------------------------------- 凭据

let cachedKey = null
function getKey() {
  if (process.env.TENCENT_TOKENHUB_API_KEY) return process.env.TENCENT_TOKENHUB_API_KEY
  if (cachedKey) return cachedKey
  const authPath = path.join(os.homedir(), '.pi', 'agent', 'auth.json')
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'))
  const k = auth?.[cfg.authKey]?.key
  if (!k) throw new Error(`auth.json 里找不到 "${cfg.authKey}" 的 key`)
  cachedKey = k
  return k
}

// ---------------------------------------------------------------- 故障判定

const ALWAYS = new Set(cfg.failoverStatus ?? [429, 402, 403, 404, 500, 502, 503, 504])

function looksLikeExhaustion(status, text) {
  if (ALWAYS.has(status)) return true
  const low = text.toLowerCase()
  return (cfg.failoverKeywords ?? []).some((k) => low.includes(k.toLowerCase()))
}

/** 判断是否属于「这个模型没额度了」——这类才写进冷却表 */
function isQuota(status, text) {
  if (status === 429 || status === 402 || status === 403) return true
  const low = text.toLowerCase()
  return (cfg.quotaKeywords ?? []).some((k) => low.includes(k.toLowerCase()))
}

/** 判断是否属于「不会自愈的硬耗尽」（免费额度用完 / 未开按量付费） */
function isHardQuota(status, text) {
  if (status === 402) return true
  const low = text.toLowerCase()
  return (cfg.hardQuotaKeywords ?? []).some((k) => low.includes(k.toLowerCase()))
}

// ---------------------------------------------------------------- 转发

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer'])

function relayHeaders(up) {
  const out = {}
  for (const [k, v] of Object.entries(up.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v
  }
  return out
}

function callUpstream(model, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ ...bodyObj, model }), 'utf8')
    const t = cfg.upstreamTimeoutMs ?? 25000
    const req = https.request(
      {
        host: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          authorization: `Bearer ${getKey()}`,
          'accept-encoding': 'identity',
          accept: 'application/json, text/event-stream',
        },
      },
      (up) => {
        // 响应头已到 → 取消“首字节超时”，否则推理模型停颈 > 25s 会被误杀（表现为流被截断/空响应）
        req.setTimeout(0)
        // 但也不能永久等：流式空闲超过 streamIdleTimeoutMs（默认 180s）就断开，
        // 让它变成一次显式失败交给调用方重试，而不是无声卡死
        const idle = cfg.streamIdleTimeoutMs ?? 180000
        let timer = null
        const arm = () => { clearTimeout(timer); timer = setTimeout(() => up.destroy(new Error(`stream idle ${idle}ms`)), idle) }
        up.on('data', arm)
        up.on('end', () => clearTimeout(timer))
        up.on('error', () => clearTimeout(timer))
        arm()
        resolve(up)
      }
    )
    req.on('error', reject)
    // 仅限制「第一个字节/响应头」的等待时长
    req.setTimeout(t, () => req.destroy(new Error(`upstream first-byte timeout ${t}ms`)))
    req.end(payload)
  })
}

/** 降权：把响应慢/不稳定的模型排到优先队列最后，下轮优先试别的 */
function deprioritize(model) {
  state.preferred = [...state.preferred.filter((m) => m !== model), model].slice(-6)
  saveState()
}

function readUpstream(up) {
  return new Promise((resolve) => {
    const chunks = []
    up.on('data', (c) => chunks.push(c))
    up.on('end', () => resolve(Buffer.concat(chunks)))
    up.on('error', () => resolve(Buffer.concat(chunks)))
  })
}

/**
 * 流式响应嗅探：先偷看开头一小段再决定是否已经「真正开工」
 *   - 开头就带 error / 配额错误 → ok=false，交给上层标记耗尽并换下一个模型
 *   - 已出现 content / reasoning_content / tool_calls → ok=true，把已缓冲的字节一并写回客户端
 *   - 什么都没产出就 EOF → ok=false（空响应，属于失败）
 *   - 超时仍无内容（长思考）→ 放行，避免误判
 */
function sniffStream(up, { maxBytes = cfg.streamSniffMaxBytes ?? 8192, timeoutMs = cfg.streamSniffTimeoutMs ?? 60000 } = {}) {
  if (cfg.streamSniff === false) return Promise.resolve({ ok: true, chunks: [], text: '', sniffed: false })
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      up.off('data', onData)
      up.off('end', onEnd)
      up.off('error', onErr)
      up.pause()
      resolve({ ok, chunks, bytes, text: Buffer.concat(chunks).toString('utf8'), sniffed: true })
    }
    const onData = (c) => {
      chunks.push(c)
      bytes += c.length
      const text = Buffer.concat(chunks).toString('utf8')
      const head = text.slice(0, 400)
      if (/"error"\s*:/.test(head) || /"type"\s*:\s*"error"/.test(head) || /^event:\s*error/m.test(head)) {
        return finish(false)
      }
      if (/"(content|reasoning_content|tool_calls|function)"\s*:/.test(text)) return finish(true)
      if (bytes >= maxBytes) return finish(true)
    }
    const onEnd = () => finish(false)
    const onErr = () => finish(false)
    const timer = setTimeout(() => finish(true), timeoutMs)
    up.on('data', onData)
    up.on('end', onEnd)
    up.on('error', onErr)
  })
}

// ---------------------------------------------------------------- 主逻辑

async function handleChat(req, res, rawBody) {
  let bodyObj
  try {
    bodyObj = JSON.parse(rawBody.toString('utf8'))
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'invalid JSON body', type: 'invalid_request_error' } }))
  }

  const requested = String(bodyObj.model ?? '')
  const isAuto = cfg.autoAliases.includes(requested)
  const explicitFailover = cfg.failoverForExplicitModels === true
  let candidates

  if (isAuto) {
    candidates = availableChain()
  } else if (explicitFailover) {
    candidates = [requested, ...availableChain().filter((m) => m !== requested)]
  } else {
    candidates = [requested]
  }

  const streaming = bodyObj.stream === true
  const attempts = []
  const startedAt = Date.now()
  const maxFailoverMs = cfg.maxFailoverMs ?? 60000

  if (!candidates.length) {
    log('ALL FAILED (无可用候选: 全部硬耗尽/冷却中)')
    res.writeHead(503, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({
      error: {
        message: '所有候选模型都不可用（全部处于硬耗尽或冷却中）。请充值/开通按量计费，或换其他 provider。',
        type: 'all_models_failed',
        hardExhausted: Object.keys(state.hard),
      },
    }))
  }

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]
    if (Date.now() - startedAt > maxFailoverMs) {
      attempts.push(`(放弃继续换模型: 已耗时 ${Math.round((Date.now() - startedAt) / 1000)}s)`)
      break
    }
    const maxTry = (cfg.retrySameModelOn5xx ?? 1) + 1

    for (let t = 0; t < maxTry; t++) {
      let up
      try {
        up = await callUpstream(model, bodyObj)
      } catch (e) {
        attempts.push(`${model}: ${e.message}`)
        if (/timeout/i.test(e.message)) deprioritize(model)
        log(`SKIP ${model} :: ${e.message}${candidates[i + 1] ? `  → 换用 ${candidates[i + 1]}` : '  → 没有下一个了'}`)
        continue
      }

      const status = up.statusCode ?? 0

      // ---- 成功：直接透传（流式/非流式都走这里）
      if (status < 400) {
        if (streaming) {
          const sniff = await sniffStream(up)
          if (!sniff.ok) {
            const snip = sniff.text.replace(/\s+/g, ' ').slice(0, 200)
            attempts.push(`${model}: 流内错误/空响应 ${snip}`)
            if (isQuota(status, sniff.text)) {
              markExhausted(model, { hard: isHardQuota(status, sniff.text), reason: snip })
            }
            const next = candidates[i + 1]
            log(`SKIP(stream) ${model} :: ${snip || '空响应'}${next ? `  → 换用 ${next}` : '  → 没有下一个了'}`)
            break
          }
          recordSuccess(model)
          res.writeHead(status, relayHeaders(up))
          for (const c of sniff.chunks) res.write(c)
          up.pipe(res)
          log(`OK (stream) ${model}${sniff.sniffed ? ` [sniff ${sniff.bytes}B]` : ''}`)
          return
        }
        const buf = await readUpstream(up)
        const text = buf.toString('utf8')
        // 少数厂商会用 200 包一个 error
        if (/"(error|Error)"\s*:/.test(text.slice(0, 400)) && isQuota(200, text)) {
          attempts.push(`${model}: 200-with-error`)
          markExhausted(model, { hard: isHardQuota(200, text), reason: '200-with-error' })
          break
        }
        recordSuccess(model)
        res.writeHead(status, relayHeaders(up))
        res.end(buf)
        log(`OK ${model}`)
        return
      }

      // ---- 失败
      const buf = await readUpstream(up)
      const text = buf.toString('utf8')
      const snippet = text.replace(/\s+/g, ' ').slice(0, 200)
      attempts.push(`${model}: HTTP ${status} ${snippet}`)

      const retrySame = t < maxTry - 1 && status >= 500
      if (retrySame) {
        log(`RETRY ${model} (${t + 1}/${maxTry}) HTTP ${status}`)
        continue // 5xx 先原模型重试
      }

      if (isQuota(status, text)) markExhausted(model, { hard: isHardQuota(status, text), reason: snippet })

      if (looksLikeExhaustion(status, text)) {
        const next = candidates[i + 1]
        log(`SKIP ${model} HTTP ${status} :: ${snippet}${next ? `  → 换用 ${next}` : '  → 没有下一个了'}`)
        break // 换下一个模型
      }

      // 不是「换个模型就能解决」的错误 → 原样返回
      log(`FAIL(no-failover) ${model} HTTP ${status} :: ${snippet}`)
      res.writeHead(status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: snippet, type: 'upstream_error', model } }))
    }
  }

  log('ALL FAILED :: ' + attempts.join(' || '))
  res.writeHead(503, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    error: {
      message: `所有候选模型都不可用（${attempts.length} 次尝试）。明细见 gateway.log`,
      type: 'all_models_failed',
      attempts,
    },
  }))
}

// ---------------------------------------------------------------- 其他路由

function proxyModels(req, res) {
  const r = https.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: '/v1/models', method: 'GET',
      headers: { authorization: `Bearer ${getKey()}`, 'accept-encoding': 'identity' } },
    (up) => {
      const chunks = []
      up.on('data', (c) => chunks.push(c))
      up.on('end', () => {
        res.writeHead(up.statusCode ?? 502, { 'content-type': 'application/json' })
        res.end(Buffer.concat(chunks))
      })
    }
  )
  r.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })) })
  r.end()
}

function statusPage(res) {
  const now = Date.now()
  const rows = cfg.chain.map((m) => {
    const t = state.exhausted[m]
    const left = t ? Math.max(0, cooldownFor(m) - (now - t)) : 0
    const h = !!state.hard[m]
    const st = t && left > 0
      ? (h ? `硬耗尽·冷却中 (剩 ${Math.ceil(left / 60000)} 分钟)` : `冷却中 (剩 ${Math.ceil(left / 60000)} 分钟)`)
      : '可用'
    return { model: m, status: st, fails: state.fails[m] ?? 0, hard: h,
             lastExhaustedAt: t ? new Date(t).toISOString() : null }
  })
  const order = availableChain()
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({
    effectiveOrder: order,
    // 硬耗尽（免费额度用完/未开按量）不会被 6 小时冷却自愈，需要充值或重置
    hardExhausted: Object.keys(state.hard),
    preferred: state.preferred,
    chain: rows,
    note: 'POST /admin/reset 清空冷却表（硬耗尽模型也会被清掉）',
  }, null, 2))
}

// ---------------------------------------------------------------- 服务

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]

  if (url === '/healthz') { res.writeHead(200); return res.end('ok') }
  if (url === '/admin/status') return statusPage(res)
  if (url === '/admin/reset') {
    state.exhausted = {}
    state.hard = {}
    state.fails = {}
    saveState()
    res.writeHead(200)
    return res.end('reset')
  }
  if (req.method === 'GET' && url.endsWith('/models')) return proxyModels(req, res)

  if (req.method === 'POST' && (url.endsWith('/chat/completions') || url.endsWith('/completions'))) {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => handleChat(req, res, Buffer.concat(chunks)).catch((e) => {
      log('handler crash: ' + e.stack)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(e) } }))
    }))
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `no route for ${req.method} ${url}` } }))
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`端口 ${cfg.port} 已被占用，本实例退出（说明网关已在运行）`)
    process.exit(0)
  }
  log('server error: ' + e.stack)
  process.exit(1)
})

server.listen(cfg.port, '127.0.0.1', () => {
  log(`TokenHub 网关已启动 → http://127.0.0.1:${cfg.port}/v1  (auto 链长 ${cfg.chain.length})`)
})
