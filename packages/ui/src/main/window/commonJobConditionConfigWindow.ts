import { BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { writeConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import {
  normalizeKeywordList,
  normalizeKeywordMatchMode
} from '@geekgeekrun/geek-auto-start-chat-with-boss/job-filter.mjs'

export let commonJobConditionConfigWindow: BrowserWindow | null = null
export function createCommonJobConditionConfigWindow(
  opt?: Electron.BrowserWindowConstructorOptions
): BrowserWindow {
  // Create the browser window.
  if (commonJobConditionConfigWindow) {
    commonJobConditionConfigWindow!.show()
  }
  commonJobConditionConfigWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    },
    ...opt
  })

  commonJobConditionConfigWindow.on('ready-to-show', () => {
    commonJobConditionConfigWindow!.show()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (process.env.NODE_ENV === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    commonJobConditionConfigWindow.loadURL(
      process.env['ELECTRON_RENDERER_URL'] + '#/commonJobConditionConfig'
    )
  } else {
    commonJobConditionConfigWindow.loadURL(
      'file://' + path.join(__dirname, '../renderer/index.html') + '#/commonJobConditionConfig'
    )
  }

  commonJobConditionConfigWindow!.once('closed', () => {
    commonJobConditionConfigWindow = null
  })

  ipcMain.handle('save-common-job-condition-config', async (_ev, payload) => {
    if (Object.hasOwn(payload ?? {}, 'blockCompanyKeywordList')) {
      payload.blockCompanyKeywordList = normalizeKeywordList(payload.blockCompanyKeywordList)
      // 关键词已取代旧版正则，不再保留正则，避免两套配置同时生效
      payload.blockCompanyNameRegExpStr = ''
    }
    if (Object.hasOwn(payload ?? {}, 'blockJobKeywordList')) {
      payload.blockJobKeywordList = normalizeKeywordList(payload.blockJobKeywordList)
    }
    if (Object.hasOwn(payload ?? {}, 'blockCompanyKeywordExcludeList')) {
      payload.blockCompanyKeywordExcludeList = normalizeKeywordList(
        payload.blockCompanyKeywordExcludeList
      )
    }
    if (Object.hasOwn(payload ?? {}, 'blockJobKeywordExcludeList')) {
      payload.blockJobKeywordExcludeList = normalizeKeywordList(payload.blockJobKeywordExcludeList)
    }
    if (Object.hasOwn(payload ?? {}, 'blockCompanyKeywordMatchMode')) {
      payload.blockCompanyKeywordMatchMode = normalizeKeywordMatchMode(
        payload.blockCompanyKeywordMatchMode
      )
    }
    if (Object.hasOwn(payload ?? {}, 'blockJobKeywordMatchMode')) {
      payload.blockJobKeywordMatchMode = normalizeKeywordMatchMode(payload.blockJobKeywordMatchMode)
    }
    await writeConfigFile('common-job-condition-config.json', payload)
    commonJobConditionConfigWindow!.close()
  })
  commonJobConditionConfigWindow!.once('closed', () => {
    ipcMain.removeHandler('save-common-job-condition-config')
  })

  return commonJobConditionConfigWindow!
}
