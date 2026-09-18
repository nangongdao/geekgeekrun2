import DingtalkPlugin from '@geekgeekrun/dingtalk-plugin/index.mjs'
import { mainLoop, closeBrowserWindow, decideRecoveryAction } from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
import {
  SyncHook,
  AsyncSeriesHook
} from 'tapable'
import fs from 'node:fs'
import { readConfigFile, readStorageFile, getPublicDbFilePath, storageFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import path from 'node:path'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import {
  AUTO_CHAT_ERROR_EXIT_CODE
} from './enums.mjs'

import SqlitePluginModule from '@geekgeekrun/sqlite-plugin'
const {
  default: SqlitePlugin
} = SqlitePluginModule

const rerunInterval = (() => {
  let v = Number(process.env.MAIN_BOSSGEEKGO_RERUN_INTERVAL)
  if (isNaN(v)) {
    v = 5000
  }

  return v
})()

process.on('disconnect', () => {
  process.exit()
})

const bossCookies = readStorageFile('boss-cookies.json')
const { groupRobotAccessToken: dingTalkAccessToken } = readConfigFile('dingtalk.json')

/**
 * 没有显式指定 PUPPETEER_EXECUTABLE_PATH 时，复用 UI 里“浏览器助手”记住的浏览器，
 * 让命令行方式与图形界面使用同一个浏览器，免去重复配置。
 */
const resolvePuppeteerExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH
  }
  const recordFilePath = path.join(storageFilePath, 'last-used-browser-record')
  try {
    const [executablePath] = fs.readFileSync(recordFilePath).toString().split('\n').map(it => it.trim())
    if (executablePath && fs.existsSync(executablePath)) {
      return executablePath
    }
  } catch {}
  return null
}

const initPlugins = (hooks) => {
  new DingtalkPlugin(dingTalkAccessToken).apply(hooks)
  new SqlitePlugin(getPublicDbFilePath()).apply(hooks)
}

const main = async () => {
  if (!bossCookies?.length) {
    console.error('There is no cookies. You can save a copy with EditThisCookie extension.')
    process.exit(AUTO_CHAT_ERROR_EXIT_CODE.COOKIE_INVALID)
  }
  const puppeteerExecutablePath = resolvePuppeteerExecutablePath()
  if (puppeteerExecutablePath) {
    process.env.PUPPETEER_EXECUTABLE_PATH = puppeteerExecutablePath
    console.log(`[Run core main] Using browser: ${puppeteerExecutablePath}`)
  } else {
    console.log('[Run core main] PUPPETEER_EXECUTABLE_PATH is not set, puppeteer will use its bundled browser if available.')
  }
  const hooks = {
    daemonInitialized: new AsyncSeriesHook(),
    puppeteerLaunched: new SyncHook(['browser']),
    pageGotten: new SyncHook(['page']),
    pageLoaded: new SyncHook(),
    cookieWillSet: new AsyncSeriesHook(['cookies']),
    userInfoResponse: new AsyncSeriesHook(['userInfo']),
    mainFlowWillLaunch: new AsyncSeriesHook(['args']),
    jobDetailIsGetFromRecommendList: new AsyncSeriesHook(['positionInfoDetail']),
    newChatWillStartup: new AsyncSeriesHook(['positionInfoDetail']),
    newChatStartup: new AsyncSeriesHook(['positionInfoDetail', 'chatRunningContext']),
    jobMarkedAsNotSuit: new AsyncSeriesHook(['positionInfoDetail', 'markDetail']),
    noPositionFoundForCurrentJob: new SyncHook(),
    noPositionFoundAfterTraverseAllJob: new SyncHook(),
    errorEncounter: new SyncHook(['errorInfo']),
    encounterEmptyRecommendJobList: new AsyncSeriesHook(['args']),
    sageTimeEnter: new AsyncSeriesHook(['args']),
    sageTimeExit: new AsyncSeriesHook(['args'])
  }
  initPlugins(hooks)
  await hooks.daemonInitialized.callAsync()
  while (true) {
    try {
      await mainLoop(hooks)
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('LOGIN_STATUS_INVALID')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID)
          break
        }
        if (err.message.includes('ERR_INTERNET_DISCONNECTED')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ERR_INTERNET_DISCONNECTED)
          break
        }
        if (err.message.includes('ACCESS_IS_DENIED')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ACCESS_IS_DENIED)
          break
        }
      }
      console.error(err)
      if (decideRecoveryAction(err) === 'restart-browser') {
        await closeBrowserWindow()
        console.log(`[Run core main] An internal error is caught, and browser will be restarted in ${rerunInterval}ms.`)
      } else {
        console.log(`[Run core main] An internal error is caught, browser is still alive and will be reused; flow will be re-entered in ${rerunInterval}ms.`)
      }
      await sleep(rerunInterval)
    }
  }
}

(async () => {
  try {
    await main()
  } catch(err) {
    console.error(err)
  }
})()