/**
 * 构造「守护进程 → 核心子进程」的启动参数。
 *
 * 单独成文件是为了可测试：Windows 上 Node ESM 对这两个参数的要求**恰好相反**，
 * 写错一次就是无限崩溃重启（历史上真实发生过，见 docs/UPGRADE_PLAN_2026-09.md §10）。
 *
 * - `--import` 的值是 **ESM specifier**，必须是 `file://` URL。
 *   传 `E:\xxx\register-hooks.mjs` 会被解析成 scheme 为 `e:` 的 URL，直接抛
 *   `ERR_UNSUPPORTED_ESM_URL_SCHEME`（错误信息：On Windows, absolute paths must be valid file:// URLs）。
 * - 入口脚本是 **路径**，必须保持原生路径形式（Windows 上用反斜杠）。
 *   传 `file:///E:/xxx/main.mjs` 会被当成字面路径去找文件，同样起不来。
 *
 * 所以不能偷懒「一把 pathToFileURL 全转」，必须分别处理。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const CORE_HOOKS_FILE_NAME = 'register-hooks.mjs'
export const CORE_ENTRY_FILE_NAME = 'main.mjs'

/**
 * @param {object} options
 * @param {string} options.dir 核心包所在目录（`run-core-of-geek-auto-start-chat-with-boss`）
 * @returns {string[]} 可直接传给 `child_process.spawn(process.execPath, args)` 的参数数组
 */
export function buildCoreChildProcessArgs({ dir } = {}) {
  if (!dir) {
    throw new Error('buildCoreChildProcessArgs: 缺少 dir 参数')
  }
  return [
    '--import',
    // ESM specifier：必须 file:// URL，否则 Windows 盘符被当成 URL scheme
    pathToFileURL(path.join(dir, CORE_HOOKS_FILE_NAME)).href,
    // 入口脚本：必须是原生路径，file:// URL 反而失败
    path.join(dir, CORE_ENTRY_FILE_NAME)
  ]
}
