const EXTENSION_CANDIDATES = ['.js', '.mjs', '.cjs', '/index.js', '/index.mjs', '/index.cjs']
const RETRYABLE_ERROR_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'])

function hasFileExtension(specifier) {
  const lastSegment = specifier.split(/[\\/]/).pop() ?? ''
  return /\.[cm]?[jt]sx?$|\.json$|\.node$/i.test(lastSegment)
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (
      !RETRYABLE_ERROR_CODES.has(err?.code) ||
      hasFileExtension(specifier) ||
      /^node:/.test(specifier)
    ) {
      throw err
    }
    for (const ext of EXTENSION_CANDIDATES) {
      try {
        return await nextResolve(`${specifier}${ext}`, context)
      } catch {
        // try next candidate
      }
    }
    throw err
  }
}
