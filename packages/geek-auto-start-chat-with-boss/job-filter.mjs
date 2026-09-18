/**
 * 关键词式的“职位 / 公司屏蔽”过滤器。
 *
 * 这个模块只包含纯函数，不依赖 puppeteer、不读配置文件，
 * 因此可以在核心流程、Electron 主进程以及渲染进程（配置界面）中共用，
 * 保证三端对“什么算命中”的理解完全一致。
 *
 * 配置约定（boss.json / common-job-condition-config.json 中均可出现）：
 *   blockCompanyKeywordList           string[]  公司名称包含任一关键词即屏蔽
 *   blockCompanyKeywordExcludeList    string[]  公司名称命中排除词时不屏蔽（与上面成对使用）
 *   blockCompanyKeywordMatchMode      string    'contains'（默认）| 'exact'，见 KEYWORD_MATCH_MODES
 *   blockJobKeywordList               string[]  职位信息包含任一关键词即屏蔽
 *   blockJobKeywordExcludeList        string[]  职位信息命中排除词时不屏蔽（与上面成对使用）
 *   blockJobKeywordMatchMode          string    'contains'（默认）| 'exact'
 *   blockJobKeywordMatchFields        string[]  职位关键词的匹配范围，见 JOB_KEYWORD_MATCH_FIELDS
 *
 * 仅存在于 boss.json（属于“本次运行策略”，不进公共配置）：
 *   blockCompanyNameRegMatchStrategy  MarkAsNotSuitOp  公司命中后的处理方式
 *   blockJobKeywordMatchStrategy      MarkAsNotSuitOp  职位命中后的处理方式
 *
 * 排除词用于消解误伤：例如屏蔽“外包”，但希望放行“非外包 / 无外包”的职位，
 * 就把“非外包”填进排除词；命中排除词时该条职位按“未命中”处理。
 * 排除词与屏蔽词使用**同一个匹配模式**，不存在两套规则。
 *
 * 兼容：旧版 blockCompanyNameRegExpStr（正则）在关键词列表为空时仍然生效。
 */

export const JOB_KEYWORD_MATCH_FIELDS = [
  { key: 'jobName', label: '职位名称' },
  { key: 'jobType', label: '职位类型' },
  { key: 'jobDesc', label: '职位描述' }
]

export const DEFAULT_JOB_KEYWORD_MATCH_FIELDS = JOB_KEYWORD_MATCH_FIELDS.map((it) => it.key)

/**
 * 关键词的匹配模式。
 *
 * - `contains`（默认）：文本包含关键词即命中，最宽松，兼容历史行为。
 * - `exact`：把文本先去掉空白、再按“标点 + 中西文交界”切成词，
 *   关键词必须与其中某个词**完全相等**才算命中。
 *
 * `exact` 解决的是“拼接命中”问题：填「前端」原本会命中「资深前端」「前端开发工程师」，
 * 切词后都不会命中，但「前端 / 后端」这种用标点分开的会命中；
 * 「Java开发」会在中西文交界处切成 `java` + `开发`，因此填「Java」能命中。
 *
 * 注意 `exact` 同样忽略空白，所以英文短语会被当作一个整体
 * （「Senior Front End Developer」切不出 `front`）。需要宽松匹配就用 `contains`。
 */
export const KEYWORD_MATCH_MODES = [
  {
    key: 'contains',
    label: '包含匹配',
    description: '文本包含关键词即命中（默认，最宽松）'
  },
  {
    key: 'exact',
    label: '精准匹配',
    description: '按标点与中西文交界切词，关键词须与某个词完全一致（避免「资深前端」被「前端」命中）'
  }
]

export const DEFAULT_KEYWORD_MATCH_MODE = 'contains'

/**
 * 归一化匹配模式：非法值一律回落到默认的 `contains`，保证手工改坏配置也能跑。
 */
export function normalizeKeywordMatchMode(value) {
  return KEYWORD_MATCH_MODES.some((it) => it.key === value) ? value : DEFAULT_KEYWORD_MATCH_MODE
}

export function keywordMatchModeLabel(value) {
  const mode = normalizeKeywordMatchMode(value)
  return KEYWORD_MATCH_MODES.find((it) => it.key === mode).label
}

/**
 * `describe()` 里的匹配模式后缀：默认模式不输出，保持既有日志文案稳定。
 */
function describeMatchMode(mode) {
  return mode === DEFAULT_KEYWORD_MATCH_MODE ? '' : `；匹配模式：${keywordMatchModeLabel(mode)}`
}

const KEYWORD_SEPARATOR = /[,，、;；\n\r]+/

/** 非文字字符（标点、括号、斜杠、空白等）：精准匹配时作为切词边界 */
const NON_TEXT_CHARACTER = /[^\p{Script=Han}\p{L}\p{N}]+/gu

/** 汉字段 / 非汉字段：在汉字与拉丁字母、数字的交界处切词 */
const SCRIPT_SEGMENT = /[\p{Script=Han}]+|[^\p{Script=Han}]+/gu

/**
 * 精准匹配用的切词。
 *
 * 分两步：
 * 1. 先按 `normalizeText` 去掉空白并转小写（与 `contains` 模式的“忽略大小写与空白”保持一致）；
 * 2. 按“非文字字符”（标点、括号、斜杠等）切段，再在汉字与其它文字（拉丁字母 / 数字）的
 *    交界处切一刀，于是 `Java开发` -> `['java', '开发']`。
 */
function tokenizeForExactMatch(text) {
  const compact = normalizeText(text)
  if (!compact) {
    return []
  }
  const tokens = []
  for (const rough of compact.split(NON_TEXT_CHARACTER)) {
    if (!rough) {
      continue
    }
    for (const segment of rough.match(SCRIPT_SEGMENT) ?? []) {
      if (segment) {
        tokens.push(segment)
      }
    }
  }
  return tokens
}

/**
 * 把用户输入（逗号 / 中文逗号 / 换行分隔的字符串，或字符串数组）整理成干净的关键词数组：
 * 去首尾空白、去空项、忽略大小写去重、保持原始顺序。
 */
export function normalizeKeywordList(input) {
  let rawList = []
  if (Array.isArray(input)) {
    rawList = input
  } else if (typeof input === 'string') {
    rawList = input.split(KEYWORD_SEPARATOR)
  }
  const seen = new Set()
  const result = []
  for (const raw of rawList) {
    const keyword = String(raw ?? '').trim()
    if (!keyword) {
      continue
    }
    const dedupeKey = normalizeText(keyword)
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    result.push(keyword)
  }
  return result
}

/**
 * 关键词数组 -> 适合放进文本框的字符串。
 */
export function keywordListToText(list) {
  return normalizeKeywordList(list).join(',')
}

/**
 * 旧版“不期望投递公司正则”若只是 `a|b|c` 这样的字面量列表，直接转换为关键词数组；
 * 含有其它正则元字符时返回 null，表示无法安全转换。
 */
export function convertLegacyRegExpStrToKeywordList(regExpStr) {
  if (typeof regExpStr !== 'string' || !regExpStr.trim()) {
    return []
  }
  if (/[\\^$.*+?()[\]{}]/.test(regExpStr)) {
    return null
  }
  return normalizeKeywordList(regExpStr.split('|'))
}

function normalizeText(text) {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * 在文本中查找第一个命中的关键词（忽略大小写与空白），未命中返回 null。
 *
 * @param {string} text
 * @param {string[]} keywordList
 * @param {object} [options]
 * @param {'contains' | 'exact'} [options.matchMode] 见 KEYWORD_MATCH_MODES，默认 `contains`
 */
export function findMatchedKeyword(text, keywordList, { matchMode } = {}) {
  const mode = normalizeKeywordMatchMode(matchMode)
  const list = keywordList ?? []

  if (mode === 'exact') {
    const tokens = new Set(tokenizeForExactMatch(text))
    if (!tokens.size) {
      return null
    }
    for (const keyword of list) {
      const needle = normalizeText(keyword)
      if (needle && tokens.has(needle)) {
        return keyword
      }
    }
    return null
  }

  const haystack = normalizeText(text)
  if (!haystack) {
    return null
  }
  for (const keyword of list) {
    const needle = normalizeText(keyword)
    if (needle && haystack.includes(needle)) {
      return keyword
    }
  }
  return null
}

/**
 * 公司屏蔽匹配器。
 *
 * @param {object} options
 * @param {string[] | string} [options.keywordList]        命中即屏蔽的关键词
 * @param {string[] | string} [options.excludeKeywordList] 命中则不屏蔽的排除词（消解误伤）
 * @param {string} [options.legacyRegExpStr]               旧版正则，仅在关键词为空时兜底
 * @param {'contains' | 'exact'} [options.matchMode]       匹配模式，默认 `contains`
 * @returns {{ isEnabled: boolean, keywords: string[], excludeKeywords: string[], matchMode: string, test(brandName: string): { matched: boolean, keyword: string | null, excludedKeyword: string | null }, describe(): string }}
 */
export function createCompanyBlockMatcher({ keywordList, excludeKeywordList, legacyRegExpStr, matchMode } = {}) {
  const keywords = normalizeKeywordList(keywordList)
  const excludeKeywords = normalizeKeywordList(excludeKeywordList)
  const mode = normalizeKeywordMatchMode(matchMode)
  let legacyRegExp = null
  if (!keywords.length && typeof legacyRegExpStr === 'string' && legacyRegExpStr.trim()) {
    try {
      legacyRegExp = new RegExp(legacyRegExpStr, 'im')
    } catch {
      legacyRegExp = null
    }
  }
  const isEnabled = keywords.length > 0 || !!legacyRegExp

  return {
    isEnabled,
    keywords,
    excludeKeywords,
    matchMode: mode,
    test(brandName) {
      if (!isEnabled) {
        return { matched: false, keyword: null, excludedKeyword: null }
      }
      const text = String(brandName ?? '')
      // 排除词优先：命中排除词的公司一律放行
      const excludedKeyword = findMatchedKeyword(text, excludeKeywords, { matchMode: mode })
      if (excludedKeyword) {
        return { matched: false, keyword: null, excludedKeyword }
      }
      if (keywords.length) {
        const keyword = findMatchedKeyword(text, keywords, { matchMode: mode })
        return { matched: !!keyword, keyword, excludedKeyword: null }
      }
      const matched = legacyRegExp.test(text)
      return { matched, keyword: matched ? `/${legacyRegExp.source}/` : null, excludedKeyword: null }
    },
    describe() {
      if (!isEnabled) {
        return '未启用'
      }
      const excludeSuffix = excludeKeywords.length ? `；排除词：${excludeKeywords.join('，')}` : ''
      if (keywords.length) {
        return `关键词：${keywords.join('，')}${describeMatchMode(mode)}${excludeSuffix}`
      }
      return `正则（旧版兼容）：${legacyRegExp.source}${excludeSuffix}`
    }
  }
}

function pickJobFieldText(jobInfo, fieldKey) {
  switch (fieldKey) {
    case 'jobName':
      return jobInfo?.jobName
    case 'jobType':
      return jobInfo?.positionName
    case 'jobDesc':
      return jobInfo?.postDescription
    default:
      return ''
  }
}

/**
 * 职位屏蔽匹配器。
 *
 * - test(jobInfo)        针对职位详情（jobInfo: { jobName, positionName, postDescription }）做完整匹配
 * - testListItem(item)   针对列表项（只有 jobName）做预筛，用于在不点开详情的情况下提前跳过
 *
 * 排除词在**同一个字段文本**上判断：该字段命中了屏蔽词、同时又命中排除词时，
 * 这条字段视为未命中，继续检查下一个字段。这样可以消解“外包”误伤“非外包”这类情况，
 * 又不会因为职位描述里出现一次排除词就放行整个职位（只要别的字段实打实命中了屏蔽词）。
 *
 * @param {object} options
 * @param {string[] | string} [options.keywordList]
 * @param {string[] | string} [options.excludeKeywordList]
 * @param {string[]} [options.matchFields] 见 JOB_KEYWORD_MATCH_FIELDS
 * @param {'contains' | 'exact'} [options.matchMode] 匹配模式，默认 `contains`
 */
export function createJobBlockMatcher({ keywordList, excludeKeywordList, matchFields, matchMode } = {}) {
  const keywords = normalizeKeywordList(keywordList)
  const excludeKeywords = normalizeKeywordList(excludeKeywordList)
  const mode = normalizeKeywordMatchMode(matchMode)
  const allowedFieldKeys = new Set(DEFAULT_JOB_KEYWORD_MATCH_FIELDS)
  let fields = (Array.isArray(matchFields) ? matchFields : []).filter((it) => allowedFieldKeys.has(it))
  if (!fields.length) {
    fields = [...DEFAULT_JOB_KEYWORD_MATCH_FIELDS]
  }
  const isEnabled = keywords.length > 0
  const labelOf = (fieldKey) => JOB_KEYWORD_MATCH_FIELDS.find((it) => it.key === fieldKey)?.label ?? fieldKey

  const NOT_MATCHED = { matched: false, field: null, fieldLabel: null, keyword: null, excludedKeyword: null }

  const testFields = (jobInfo, fieldKeys) => {
    let excludedKeyword = null
    for (const fieldKey of fieldKeys) {
      const fieldText = pickJobFieldText(jobInfo, fieldKey)
      const keyword = findMatchedKeyword(fieldText, keywords, { matchMode: mode })
      if (!keyword) {
        continue
      }
      const excluded = findMatchedKeyword(fieldText, excludeKeywords, { matchMode: mode })
      if (excluded) {
        excludedKeyword = excluded
        continue
      }
      return { matched: true, field: fieldKey, fieldLabel: labelOf(fieldKey), keyword, excludedKeyword: null }
    }
    // 命中过屏蔽词但都被排除词放行时，把排除词带出去，方便日志解释“为什么没屏蔽”
    return excludedKeyword ? { ...NOT_MATCHED, excludedKeyword } : { ...NOT_MATCHED }
  }

  return {
    isEnabled,
    keywords,
    excludeKeywords,
    matchFields: fields,
    matchMode: mode,
    test(jobInfo) {
      if (!isEnabled) {
        return { ...NOT_MATCHED }
      }
      return testFields(jobInfo, fields)
    },
    testListItem(listItem) {
      if (!isEnabled || !fields.includes('jobName')) {
        return { ...NOT_MATCHED }
      }
      return testFields(listItem, ['jobName'])
    },
    describe() {
      if (!isEnabled) {
        return '未启用'
      }
      const excludeSuffix = excludeKeywords.length ? `；排除词：${excludeKeywords.join('，')}` : ''
      return `关键词：${keywords.join('，')}${describeMatchMode(mode)}；匹配范围：${fields.map(labelOf).join(' / ')}${excludeSuffix}`
    }
  }
}

/**
 * 统一解析“公共职位筛选条件 vs 本次运行配置”中与屏蔽相关的字段，
 * 返回可直接喂给 createCompanyBlockMatcher / createJobBlockMatcher 的参数。
 *
 * fieldsForUseCommonConfig 的开关：
 *   blockCompanyNameRegExpStr  -> 公司屏蔽（关键词 + 旧正则）使用公共配置
 *   blockJobKeyword            -> 职位屏蔽使用公共配置
 */
export function resolveBlockFilterConfig({ bossConfig = {}, commonConfig = {} } = {}) {
  const useCommon = bossConfig.fieldsForUseCommonConfig ?? {}
  const companySource = useCommon.blockCompanyNameRegExpStr ? commonConfig : bossConfig
  const jobSource = useCommon.blockJobKeyword ? commonConfig : bossConfig

  let companyKeywordList = normalizeKeywordList(companySource.blockCompanyKeywordList)
  const legacyRegExpStr = companySource.blockCompanyNameRegExpStr ?? ''
  if (!companyKeywordList.length) {
    // 旧配置只有正则时，能转换的就当作关键词，保持“无正则”的使用体验
    companyKeywordList = convertLegacyRegExpStrToKeywordList(legacyRegExpStr) ?? []
  }

  return {
    company: {
      keywordList: companyKeywordList,
      excludeKeywordList: normalizeKeywordList(companySource.blockCompanyKeywordExcludeList),
      matchMode: companySource.blockCompanyKeywordMatchMode ?? DEFAULT_KEYWORD_MATCH_MODE,
      legacyRegExpStr: companyKeywordList.length ? '' : legacyRegExpStr,
      strategy: bossConfig.blockCompanyNameRegMatchStrategy
    },
    job: {
      keywordList: normalizeKeywordList(jobSource.blockJobKeywordList),
      excludeKeywordList: normalizeKeywordList(jobSource.blockJobKeywordExcludeList),
      matchFields: jobSource.blockJobKeywordMatchFields ?? DEFAULT_JOB_KEYWORD_MATCH_FIELDS,
      matchMode: jobSource.blockJobKeywordMatchMode ?? DEFAULT_KEYWORD_MATCH_MODE,
      strategy: bossConfig.blockJobKeywordMatchStrategy
    }
  }
}
