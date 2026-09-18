/**
 * 核心流程模块的“能不能加载 + 浏览器恢复决策是否正确”冒烟测试。
 *
 * 核心包里的导入写法是为 vite 打包准备的（不带扩展名），纯 Node 运行需要
 * register-hooks.mjs 兜底，所以这个测试必须这样跑：
 *
 *   node --import ./register-hooks.mjs --test ./main-flow-smoke.test.mjs
 *
 * 根目录提供了 `pnpm test:smoke`。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCoreChildProcessArgs } from './daemon-args.mjs'

const core = await import('@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs')
const enums = await import('@geekgeekrun/sqlite-plugin/dist/enums')

describe('核心模块可加载', () => {
  it('导出 mainLoop / closeBrowserWindow 等入口', () => {
    assert.equal(typeof core.mainLoop, 'function')
    assert.equal(typeof core.initPuppeteer, 'function')
    assert.equal(typeof core.closeBrowserWindow, 'function')
    assert.ok(core.autoStartChatEventBus)
  })

  it('导出浏览器恢复决策 API（run-core 与 UI worker 共用）', () => {
    assert.equal(typeof core.isBrowserAlive, 'function')
    assert.equal(typeof core.isBrowserLevelError, 'function')
    assert.equal(typeof core.decideRecoveryAction, 'function')
  })

  it('没有浏览器时 isBrowserAlive 为 false', () => {
    assert.equal(core.isBrowserAlive(), false)
  })
})

describe('isBrowserLevelError', () => {
  it('把 CDP 会话 / 浏览器进程级错误判定为需要重启', () => {
    const browserLevelMessages = [
      'Browser has disconnected',
      'Target closed',
      'Session closed',
      'Protocol error (Page.navigate): Session closed',
      'Connection closed',
      'WebSocket is not open: readyState 3',
      'Failed to launch the browser process!'
    ]
    for (const message of browserLevelMessages) {
      assert.equal(core.isBrowserLevelError(new Error(message)), true, message)
    }
  })

  it('把页面级 / 业务级错误判定为可以复用浏览器', () => {
    const pageLevelMessages = [
      'waiting for selector `.job-list-container .rec-job-list` failed: timeout 5000ms exceeded',
      'CANNOT_FIND_EXCEPT_JOB_IN_THIS_FILTER_CONDITION',
      'Node is either not clickable or not an Element',
      '沟通次数已用完'
    ]
    for (const message of pageLevelMessages) {
      assert.equal(core.isBrowserLevelError(new Error(message)), false, message)
    }
  })

  it('非 Error 入参不抛错', () => {
    assert.equal(core.isBrowserLevelError(undefined), false)
    assert.equal(core.isBrowserLevelError(null), false)
    assert.equal(core.isBrowserLevelError('Target closed'), true)
  })
})

describe('不合适原因可读文案', () => {
  it('每个 MarkAsNotSuitReason 都有中文文案（防止新增枚举后界面显示空白）', () => {
    const entries = Object.entries(enums.MarkAsNotSuitReason).filter(
      ([, value]) => typeof value === 'number'
    )
    assert.ok(entries.length >= 9, `枚举项数量异常：${entries.length}`)
    for (const [key, value] of entries) {
      const text = enums.getMarkAsNotSuitReasonText(value)
      assert.ok(text, `${key} 没有文案`)
      assert.notEqual(text, '未知原因', `${key} 落到了兜底文案`)
    }
  })

  it('未知枚举值回落到兜底文案而不是 undefined', () => {
    assert.equal(enums.getMarkAsNotSuitReasonText(999), '未知原因')
    assert.equal(enums.getMarkAsNotSuitReasonText(undefined), '未知原因')
    assert.equal(enums.getMarkAsNotSuitReasonText(null), '未知原因')
  })

  it('职位关键词命中有独立文案，不与其它原因混用', () => {
    assert.equal(
      enums.getMarkAsNotSuitReasonText(enums.MarkAsNotSuitReason.JOB_KEYWORD_NOT_SUIT),
      '职位关键词命中'
    )
    assert.notEqual(
      enums.getMarkAsNotSuitReasonText(enums.MarkAsNotSuitReason.JOB_KEYWORD_NOT_SUIT),
      enums.getMarkAsNotSuitReasonText(enums.MarkAsNotSuitReason.JOB_NOT_SUIT)
    )
  })
})

describe('decideRecoveryAction', () => {
  it('浏览器不存在时必然重启', () => {
    // 这些用例没有真正启动浏览器，isBrowserAlive() 为 false
    assert.equal(core.decideRecoveryAction(new Error('boom')), 'restart-browser')
  })

  it('浏览器级错误必然重启', () => {
    assert.equal(core.decideRecoveryAction(new Error('Target closed')), 'restart-browser')
  })

  it('保持对外返回字符串而不是决策对象', () => {
    assert.equal(typeof core.decideRecoveryAction(new Error('x')), 'string')
  })
})

describe('resolveRecoveryAction（纯函数）', () => {
  const pageLevelError = new Error('waiting for selector failed: timeout')

  it('浏览器已挂 → 重启', () => {
    const decision = core.resolveRecoveryAction({ error: pageLevelError, browserAlive: false })
    assert.equal(decision.action, 'restart-browser')
  })

  it('浏览器级错误 → 重启', () => {
    const decision = core.resolveRecoveryAction({
      error: new Error('Session closed'),
      browserAlive: true
    })
    assert.equal(decision.action, 'restart-browser')
  })

  it('页面级错误且浏览器还在 → 复用', () => {
    const decision = core.resolveRecoveryAction({ error: pageLevelError, browserAlive: true })
    assert.equal(decision.action, 'reuse-browser')
    assert.equal(decision.nextConsecutiveSoftRecoveryFailureCount, 1)
  })

  it('连续软恢复失败到上限后升格为重启，并清零计数', () => {
    let count = 0
    const actions = []
    for (let i = 0; i < core.MAX_CONSECUTIVE_SOFT_RECOVERY; i++) {
      const decision = core.resolveRecoveryAction({
        error: pageLevelError,
        browserAlive: true,
        consecutiveSoftRecoveryFailureCount: count
      })
      count = decision.nextConsecutiveSoftRecoveryFailureCount
      actions.push(decision.action)
    }
    assert.deepEqual(actions, ['reuse-browser', 'reuse-browser', 'restart-browser'])
    assert.equal(count, 0)
  })

  it('重启决策一定会把软恢复计数清零', () => {
    const decision = core.resolveRecoveryAction({
      error: new Error('Target closed'),
      browserAlive: true,
      consecutiveSoftRecoveryFailureCount: 2
    })
    assert.equal(decision.nextConsecutiveSoftRecoveryFailureCount, 0)
  })

  it('升格重启时会给出可读日志', () => {
    const decision = core.resolveRecoveryAction({
      error: pageLevelError,
      browserAlive: true,
      consecutiveSoftRecoveryFailureCount: core.MAX_CONSECUTIVE_SOFT_RECOVERY - 1
    })
    assert.match(decision.message, /连续 3 次复用浏览器恢复失败/)
  })
})

describe('守护进程启动参数', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  const args = buildCoreChildProcessArgs({ dir })

  it('参数形态固定：--import <hooksUrl> <entryPath>', () => {
    assert.equal(args.length, 3)
    assert.equal(args[0], '--import')
  })

  it('--import 必须是 file:// URL（Windows 盘符路径会被当成 URL scheme 而崩溃）', () => {
    const hooksSpecifier = args[1]
    assert.match(hooksSpecifier, /^file:\/\//, `--import 不是 file:// URL：${hooksSpecifier}`)
    assert.equal(new URL(hooksSpecifier).protocol, 'file:')
    // 回归守卫：曾因传入 `E:\...\register-hooks.mjs` 触发 ERR_UNSUPPORTED_ESM_URL_SCHEME 无限重启
    assert.doesNotMatch(hooksSpecifier, /^[a-zA-Z]:[\\/]/)
  })

  it('入口脚本必须是原生路径而不是 file:// URL（URL 会被当成字面路径）', () => {
    assert.ok(path.isAbsolute(args[2]), `入口不是绝对路径：${args[2]}`)
    assert.doesNotMatch(args[2], /^file:/)
    assert.equal(path.basename(args[2]), 'main.mjs')
  })

  it('两个文件都真实存在（避免改名后参数静默失效）', () => {
    assert.ok(fs.existsSync(fileURLToPath(args[1])), `hooks 文件不存在：${args[1]}`)
    assert.ok(fs.existsSync(args[2]), `入口文件不存在：${args[2]}`)
  })

  it('缺少 dir 时直接抛错，而不是产出坏参数', () => {
    assert.throws(() => buildCoreChildProcessArgs(), /dir/)
    assert.throws(() => buildCoreChildProcessArgs({}), /dir/)
  })
})

describe('tapable 异步钩子调用约定', () => {
  const packageDir = fileURLToPath(new URL('.', import.meta.url))
  const sourceFiles = [
    path.join(packageDir, 'main.mjs'),
    path.join(packageDir, '..', 'geek-auto-start-chat-with-boss', 'index.mjs')
  ]

  it('源码里不得出现 callAsync()（它需要尾部回调，写成 callAsync() 必抛 _callback is not a function）', () => {
    for (const filePath of sourceFiles) {
      assert.ok(fs.existsSync(filePath), `源文件不存在：${filePath}`)
      const source = fs.readFileSync(filePath, 'utf8')
      const offenders = source
        .split(/\r?\n/)
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => /\.callAsync\s*\(/.test(line))
      assert.deepEqual(
        offenders,
        [],
        `${path.basename(filePath)} 里存在 callAsync() 调用，应改为 .promise()：` +
          offenders.map(({ lineNumber, line }) => `\n  L${lineNumber} ${line.trim()}`).join('')
      )
    }
  })

  it('零 tap 的 AsyncSeriesHook 用 .promise() 能 resolve（当前 tapable 版本的行为基线）', async () => {
    const { AsyncSeriesHook } = await import('tapable')
    const hook = new AsyncSeriesHook()
    await hook.promise()
    assert.equal(typeof hook.promise, 'function')
  })
})
