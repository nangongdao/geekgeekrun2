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
