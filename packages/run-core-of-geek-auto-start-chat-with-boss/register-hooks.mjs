/**
 * 通过 `node --import ./register-hooks.mjs main.mjs` 注入模块解析钩子。
 *
 * 核心包（geek-auto-start-chat-with-boss）为了同时服务 Electron（由 vite 打包）和这里的纯 Node 运行方式，
 * 使用了不带扩展名的导入（例如 `@geekgeekrun/sqlite-plugin/dist/enums`）。
 * vite 能解析，但原生 Node ESM 要求写全扩展名，这里补上 `.js` / `/index.js` 之类的尝试。
 */
import { register } from 'node:module'

register('./resolve-hooks.mjs', import.meta.url)
