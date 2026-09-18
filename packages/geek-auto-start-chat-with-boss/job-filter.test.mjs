/**
 * job-filter.mjs 的单元测试。
 *
 * 运行：node --test packages/geek-auto-start-chat-with-boss/job-filter.test.mjs
 * （或根目录 `pnpm test`）
 *
 * 这个文件是“什么算命中”这一唯一事实源的回归保护网：
 * 核心流程、Electron 主进程、渲染进程三端都依赖同一套规则，
 * 规则一旦漂移，这里必须先红。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_JOB_KEYWORD_MATCH_FIELDS,
  DEFAULT_KEYWORD_MATCH_MODE,
  JOB_KEYWORD_MATCH_FIELDS,
  KEYWORD_MATCH_MODES,
  convertLegacyRegExpStrToKeywordList,
  createCompanyBlockMatcher,
  createJobBlockMatcher,
  findMatchedKeyword,
  keywordListToText,
  normalizeKeywordList,
  normalizeKeywordMatchMode,
  resolveBlockFilterConfig
} from './job-filter.mjs'

describe('normalizeKeywordList', () => {
  it('按逗号 / 中文逗号 / 分号 / 换行切分', () => {
    assert.deepEqual(normalizeKeywordList('外包,驻场，销售;电销\n客服'), [
      '外包',
      '驻场',
      '销售',
      '电销',
      '客服'
    ])
  })

  it('去首尾空白与空项', () => {
    assert.deepEqual(normalizeKeywordList('  外包 , ,, 驻场  ,  '), ['外包', '驻场'])
  })

  it('忽略大小写去重且保持原始顺序', () => {
    assert.deepEqual(normalizeKeywordList('FESCO,fesco,软通动力,德科'), ['FESCO', '软通动力', '德科'])
  })

  it('忽略空白差异去重', () => {
    assert.deepEqual(normalizeKeywordList(['维 创', '维创']), ['维 创'])
  })

  it('接受数组输入并逐项清理', () => {
    assert.deepEqual(normalizeKeywordList([' 京东 ', '', null, undefined, '达达']), ['京东', '达达'])
  })

  it('非字符串非数组输入返回空数组', () => {
    assert.deepEqual(normalizeKeywordList(null), [])
    assert.deepEqual(normalizeKeywordList(undefined), [])
    assert.deepEqual(normalizeKeywordList(42), [])
    assert.deepEqual(normalizeKeywordList({}), [])
  })

  it('数字项按字符串处理而不是抛错', () => {
    assert.deepEqual(normalizeKeywordList([123, ' 456 ']), ['123', '456'])
  })
})

describe('keywordListToText', () => {
  it('转成逗号分隔文本，顺带归一化', () => {
    assert.equal(keywordListToText(['外包', ' 驻场 ', '外包']), '外包,驻场')
  })

  it('空输入得到空串', () => {
    assert.equal(keywordListToText([]), '')
    assert.equal(keywordListToText(null), '')
  })
})

describe('convertLegacyRegExpStrToKeywordList', () => {
  it('a|b|c 字面量列表可转换', () => {
    assert.deepEqual(convertLegacyRegExpStrToKeywordList('软通动力|中软国际|博彦'), [
      '软通动力',
      '中软国际',
      '博彦'
    ])
  })

  it('去重并清理空白', () => {
    assert.deepEqual(convertLegacyRegExpStrToKeywordList('德科| 德科 |科锐'), ['德科', '科锐'])
  })

  it('含正则元字符时返回 null（无法安全转换）', () => {
    assert.equal(convertLegacyRegExpStrToKeywordList('^(?!.*外包).*$'), null)
    assert.equal(convertLegacyRegExpStrToKeywordList('软通.力'), null)
    assert.equal(convertLegacyRegExpStrToKeywordList('a+b'), null)
    assert.equal(convertLegacyRegExpStrToKeywordList('(京东|达达)'), null)
  })

  it('空值返回空数组而不是 null', () => {
    assert.deepEqual(convertLegacyRegExpStrToKeywordList(''), [])
    assert.deepEqual(convertLegacyRegExpStrToKeywordList('   '), [])
    assert.deepEqual(convertLegacyRegExpStrToKeywordList(null), [])
    assert.deepEqual(convertLegacyRegExpStrToKeywordList(undefined), [])
  })
})

describe('findMatchedKeyword', () => {
  it('忽略大小写与空白', () => {
    assert.equal(findMatchedKeyword('Fesco 人力资源', ['fesco']), 'fesco')
    assert.equal(findMatchedKeyword('软 通 动 力', ['软通动力']), '软通动力')
  })

  it('未命中返回 null', () => {
    assert.equal(findMatchedKeyword('阿里巴巴', ['外包']), null)
  })

  it('空文本或空关键词列表返回 null', () => {
    assert.equal(findMatchedKeyword('', ['外包']), null)
    assert.equal(findMatchedKeyword(null, ['外包']), null)
    assert.equal(findMatchedKeyword('外包公司', []), null)
    assert.equal(findMatchedKeyword('外包公司', null), null)
  })

  it('关键词为空串时不误判为命中', () => {
    assert.equal(findMatchedKeyword('任何文本', ['', '  ']), null)
  })

  it('返回原始关键词（保序，返回第一个命中的）', () => {
    assert.equal(findMatchedKeyword('某外包服务公司', ['服务', '外包', '公司']), '服务')
  })
})

describe('createCompanyBlockMatcher', () => {
  it('未配置时 isEnabled 为 false 且永不命中', () => {
    const matcher = createCompanyBlockMatcher({})
    assert.equal(matcher.isEnabled, false)
    assert.deepEqual(matcher.test('软通动力'), { matched: false, keyword: null, excludedKeyword: null })
    assert.equal(matcher.describe(), '未启用')
  })

  it('公司名称包含关键词即命中', () => {
    const matcher = createCompanyBlockMatcher({ keywordList: ['软通动力', '中软国际'] })
    assert.equal(matcher.isEnabled, true)
    const result = matcher.test('软通动力科技股份有限公司')
    assert.equal(result.matched, true)
    assert.equal(result.keyword, '软通动力')
  })

  it('公司名不包含关键词则不命中', () => {
    const matcher = createCompanyBlockMatcher({ keywordList: ['软通动力'] })
    assert.equal(matcher.test('某互联网公司').matched, false)
  })

  it('排除词命中时放行', () => {
    const matcher = createCompanyBlockMatcher({
      keywordList: ['华为'],
      excludeKeywordList: ['华为云']
    })
    assert.equal(matcher.test('华为技术有限公司').matched, true)
    assert.deepEqual(matcher.test('华为云技术有限公司'), {
      matched: false,
      keyword: null,
      excludedKeyword: '华为云'
    })
  })

  it('只有排除词没有关键词时不算启用', () => {
    const matcher = createCompanyBlockMatcher({ excludeKeywordList: ['华为云'] })
    assert.equal(matcher.isEnabled, false)
    assert.equal(matcher.test('华为云').matched, false)
  })

  it('关键词为空时旧正则可兜底', () => {
    const matcher = createCompanyBlockMatcher({
      keywordList: [],
      legacyRegExpStr: '^(?!.*非外包).*外包'
    })
    assert.equal(matcher.isEnabled, true)
    assert.equal(matcher.test('某外包公司').matched, true)
    assert.equal(matcher.test('非外包公司').matched, false)
  })

  it('关键词存在时忽略旧正则（避免两套规则同时生效）', () => {
    const matcher = createCompanyBlockMatcher({
      keywordList: ['软通动力'],
      legacyRegExpStr: '阿里巴巴'
    })
    assert.equal(matcher.test('阿里巴巴').matched, false)
    assert.equal(matcher.test('软通动力').matched, true)
  })

  it('非法正则不抛错，退化为未启用', () => {
    assert.doesNotThrow(() => createCompanyBlockMatcher({ legacyRegExpStr: '(' }).test('任意公司'))
    const matcher = createCompanyBlockMatcher({ legacyRegExpStr: '(' })
    assert.equal(matcher.isEnabled, false)
  })

  it('describe 展示关键词与排除词', () => {
    const matcher = createCompanyBlockMatcher({
      keywordList: ['软通动力'],
      excludeKeywordList: ['软通动力大学']
    })
    assert.equal(matcher.describe(), '关键词：软通动力；排除词：软通动力大学')
  })
})

describe('createJobBlockMatcher', () => {
  const jobInfo = {
    jobName: '前端开发工程师',
    positionName: '前端开发',
    postDescription: '负责公司内部系统的前端开发，非外包岗位'
  }

  it('未配置时 isEnabled 为 false', () => {
    const matcher = createJobBlockMatcher({})
    assert.equal(matcher.isEnabled, false)
    assert.equal(matcher.test(jobInfo).matched, false)
  })

  it('默认匹配范围是三项全选', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['外包'] })
    assert.deepEqual(matcher.matchFields, DEFAULT_JOB_KEYWORD_MATCH_FIELDS)
    assert.deepEqual(DEFAULT_JOB_KEYWORD_MATCH_FIELDS, ['jobName', 'jobType', 'jobDesc'])
  })

  it('在职位名称命中（列表阶段就能跳过）', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['前端'] })
    assert.equal(matcher.test(jobInfo).matched, true)
    assert.equal(matcher.test(jobInfo).field, 'jobName')
    assert.equal(matcher.test({ jobName: '外包前端' }).field, 'jobName')
  })

  it('在职位类型命中', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['销售'] })
    const result = matcher.test({ jobName: '客户经理', positionName: '销售代表', postDescription: '' })
    assert.equal(result.matched, true)
    assert.equal(result.field, 'jobType')
    assert.equal(result.fieldLabel, '职位类型')
  })

  it('在职位描述命中', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['驻场'] })
    const result = matcher.test({ jobName: 'Java', positionName: '后端', postDescription: '需驻场办公' })
    assert.equal(result.matched, true)
    assert.equal(result.field, 'jobDesc')
    assert.equal(result.fieldLabel, '职位描述')
  })

  it('尊重 matchFields 缩小范围：只勾职位名称时不看描述', () => {
    const matcher = createJobBlockMatcher({
      keywordList: ['外包'],
      matchFields: ['jobName']
    })
    assert.deepEqual(matcher.matchFields, ['jobName'])
    assert.equal(matcher.test(jobInfo).matched, false)
    assert.equal(matcher.test({ jobName: '外包前端' }).matched, true)
  })

  it('matchFields 里的非法值被过滤，全非法时回落到全选', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['外包'], matchFields: ['不存在的字段'] })
    assert.deepEqual(matcher.matchFields, DEFAULT_JOB_KEYWORD_MATCH_FIELDS)
  })

  it('testListItem 只在 jobName 范围内预筛', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['销售'] })
    assert.equal(matcher.testListItem({ jobName: '销售代表' }).matched, true)
    // 列表项没有职位类型 / 描述字段，不应因缺失字段而抛错
    assert.equal(matcher.testListItem({}).matched, false)
  })

  it('未勾选职位名称时列表阶段不预筛，交给详情阶段', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['外包'], matchFields: ['jobDesc'] })
    assert.equal(matcher.testListItem({ jobName: '外包前端' }).matched, false)
  })

  it('排除词在同一字段内生效：外包但标注非外包则放行', () => {
    const matcher = createJobBlockMatcher({
      keywordList: ['外包'],
      excludeKeywordList: ['非外包']
    })
    const result = matcher.test(jobInfo)
    assert.equal(result.matched, false)
    assert.equal(result.excludedKeyword, '非外包')
  })

  it('排除词不跨字段放行：描述里的排除词救不了职位名称里的命中', () => {
    const matcher = createJobBlockMatcher({
      keywordList: ['外包'],
      excludeKeywordList: ['非外包']
    })
    const result = matcher.test({
      jobName: '人力外包专员',
      positionName: '人事',
      postDescription: '本岗位不是外包，非外包团队'
    })
    assert.equal(result.matched, true)
    assert.equal(result.field, 'jobName')
  })

  it('同一字段被排除后，仍会检查其它字段', () => {
    const matcher = createJobBlockMatcher({
      keywordList: ['外包'],
      excludeKeywordList: ['非外包']
    })
    const result = matcher.test({
      jobName: '前端工程师',
      positionName: '非外包前端',
      postDescription: '外包项目组'
    })
    assert.equal(result.matched, true)
    assert.equal(result.field, 'jobDesc')
  })

  it('全字段都被排除时不命中，并带出最后一个排除词', () => {
    const matcher = createJobBlockMatcher({
      keywordList: ['外包'],
      excludeKeywordList: ['非外包']
    })
    const result = matcher.test({
      jobName: '非外包前端',
      positionName: '非外包',
      postDescription: '承诺非外包'
    })
    assert.equal(result.matched, false)
    assert.equal(result.excludedKeyword, '非外包')
  })

  it('未命中时 keyword 为 null', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['外包'] })
    const result = matcher.test({ jobName: '算法工程师', positionName: '算法', postDescription: '做推荐' })
    assert.equal(result.matched, false)
    assert.equal(result.keyword, null)
    assert.equal(result.field, null)
  })

  it('describe 展示关键词、匹配范围与排除词', () => {
    const matcher = createJobBlockMatcher({
      keywordList: ['外包', '驻场'],
      excludeKeywordList: ['非外包'],
      matchFields: ['jobName', 'jobDesc']
    })
    assert.equal(matcher.describe(), '关键词：外包，驻场；匹配范围：职位名称 / 职位描述；排除词：非外包')
  })

  it('JOB_KEYWORD_MATCH_FIELDS 的键与标签保持稳定', () => {
    assert.deepEqual(
      JOB_KEYWORD_MATCH_FIELDS.map((it) => it.key),
      ['jobName', 'jobType', 'jobDesc']
    )
    assert.deepEqual(
      JOB_KEYWORD_MATCH_FIELDS.map((it) => it.label),
      ['职位名称', '职位类型', '职位描述']
    )
  })
})

describe('resolveBlockFilterConfig', () => {
  it('默认使用 boss.json 里的配置', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: { blockJobKeywordList: ['外包'], blockCompanyKeywordList: ['软通动力'] },
      commonConfig: { blockJobKeywordList: ['销售'], blockCompanyKeywordList: ['中软国际'] }
    })
    assert.deepEqual(resolved.job.keywordList, ['外包'])
    assert.deepEqual(resolved.company.keywordList, ['软通动力'])
  })

  it('开关打开时改用公共配置', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: {
        blockJobKeywordList: ['外包'],
        blockCompanyKeywordList: ['软通动力'],
        fieldsForUseCommonConfig: { blockJobKeyword: true, blockCompanyNameRegExpStr: true }
      },
      commonConfig: {
        blockJobKeywordList: ['销售'],
        blockCompanyKeywordList: ['中软国际'],
        blockJobKeywordExcludeList: ['非销售'],
        blockCompanyKeywordExcludeList: ['中软国际培训']
      }
    })
    assert.deepEqual(resolved.job.keywordList, ['销售'])
    assert.deepEqual(resolved.job.excludeKeywordList, ['非销售'])
    assert.deepEqual(resolved.company.keywordList, ['中软国际'])
    assert.deepEqual(resolved.company.excludeKeywordList, ['中软国际培训'])
  })

  it('两个开关彼此独立', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: {
        blockJobKeywordList: ['外包'],
        blockCompanyKeywordList: ['软通动力'],
        fieldsForUseCommonConfig: { blockJobKeyword: true }
      },
      commonConfig: { blockJobKeywordList: ['销售'], blockCompanyKeywordList: ['中软国际'] }
    })
    assert.deepEqual(resolved.job.keywordList, ['销售'])
    assert.deepEqual(resolved.company.keywordList, ['软通动力'])
  })

  it('旧正则只有字面量列表时自动当成关键词', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: { blockCompanyNameRegExpStr: '软通动力|中软国际' }
    })
    assert.deepEqual(resolved.company.keywordList, ['软通动力', '中软国际'])
    assert.equal(resolved.company.legacyRegExpStr, '')
  })

  it('旧正则无法转换时保留给匹配器兜底', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: { blockCompanyNameRegExpStr: '^(?!.*非外包).*外包' }
    })
    assert.deepEqual(resolved.company.keywordList, [])
    assert.equal(resolved.company.legacyRegExpStr, '^(?!.*非外包).*外包')
    const matcher = createCompanyBlockMatcher(resolved.company)
    assert.equal(matcher.isEnabled, true)
    assert.equal(matcher.test('某外包公司').matched, true)
  })

  it('策略字段透传自 boss.json（与匹配范围无关）', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: {
        blockJobKeywordList: ['外包'],
        blockJobKeywordMatchStrategy: 2,
        blockCompanyNameRegMatchStrategy: 1
      }
    })
    assert.equal(resolved.job.strategy, 2)
    assert.equal(resolved.company.strategy, 1)
  })

  it('缺省时策略为 undefined，由调用方决定默认值', () => {
    const resolved = resolveBlockFilterConfig({})
    assert.equal(resolved.job.strategy, undefined)
    assert.equal(resolved.company.strategy, undefined)
    assert.deepEqual(resolved.job.keywordList, [])
    assert.deepEqual(resolved.company.keywordList, [])
  })

  it('未传参时不抛错', () => {
    assert.doesNotThrow(() => resolveBlockFilterConfig())
  })
})

describe('端到端组合场景', () => {
  it('屏蔽外包但放行“非外包”，同时屏蔽指定公司', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: {
        blockJobKeywordList: ['外包', '驻场'],
        blockJobKeywordExcludeList: ['非外包'],
        blockCompanyKeywordList: ['软通动力'],
        blockJobKeywordMatchFields: ['jobName', 'jobType', 'jobDesc']
      }
    })
    const jobMatcher = createJobBlockMatcher(resolved.job)
    const companyMatcher = createCompanyBlockMatcher(resolved.company)

    const blockedJob = {
      jobName: '前端开发（驻场）',
      positionName: '前端开发',
      postDescription: '驻场于客户现场'
    }
    const allowedJob = {
      jobName: '前端开发',
      positionName: '前端开发',
      postDescription: '自有产品团队，非外包'
    }

    assert.equal(jobMatcher.test(blockedJob).matched, true)
    assert.equal(jobMatcher.test(allowedJob).matched, false)
    assert.equal(companyMatcher.test('软通动力信息技术有限公司').matched, true)
    assert.equal(companyMatcher.test('北京某某科技有限公司').matched, false)
  })
})

describe('normalizeKeywordMatchMode / KEYWORD_MATCH_MODES', () => {
  it('默认是 contains', () => {
    assert.equal(DEFAULT_KEYWORD_MATCH_MODE, 'contains')
    assert.equal(normalizeKeywordMatchMode(), 'contains')
    assert.equal(normalizeKeywordMatchMode(null), 'contains')
    assert.equal(normalizeKeywordMatchMode(''), 'contains')
    assert.equal(normalizeKeywordMatchMode(42), 'contains')
  })

  it('合法值原样保留，非法值回落默认而不是抛错', () => {
    assert.equal(normalizeKeywordMatchMode('contains'), 'contains')
    assert.equal(normalizeKeywordMatchMode('exact'), 'exact')
    assert.equal(normalizeKeywordMatchMode('EXACT'), 'contains')
    assert.equal(normalizeKeywordMatchMode('模糊匹配'), 'contains')
  })

  it('每个模式都有 label 与 description（配置界面直接取用）', () => {
    for (const mode of KEYWORD_MATCH_MODES) {
      assert.ok(mode.key, '缺少 key')
      assert.ok(mode.label, `${mode.key} 缺少 label`)
      assert.ok(mode.description, `${mode.key} 缺少 description`)
    }
  })

  it('模式 key 集合保持稳定（配置里存的就是它）', () => {
    assert.deepEqual(
      KEYWORD_MATCH_MODES.map((it) => it.key),
      ['contains', 'exact']
    )
  })
})

describe('精准匹配（exact）', () => {
  const exact = { matchMode: 'exact' }

  it('拼接命中不再命中：填「前端」不会命中「资深前端」「前端开发工程师」', () => {
    assert.equal(findMatchedKeyword('资深前端', ['前端'], exact), null)
    assert.equal(findMatchedKeyword('前端开发工程师', ['前端'], exact), null)
    assert.equal(findMatchedKeyword('高级前端', ['前端'], exact), null)
  })

  it('整体一致才命中', () => {
    assert.equal(findMatchedKeyword('资深前端', ['资深前端'], exact), '资深前端')
    assert.equal(findMatchedKeyword('前端', ['前端'], exact), '前端')
  })

  it('被标点 / 括号切开的部分可以命中', () => {
    assert.equal(findMatchedKeyword('前端 / 后端开发', ['前端'], exact), '前端')
    assert.equal(findMatchedKeyword('前端、后端', ['后端'], exact), '后端')
    assert.equal(findMatchedKeyword('前端（驻场）', ['驻场'], exact), '驻场')
    assert.equal(findMatchedKeyword('前端(急招)', ['急招'], exact), '急招')
  })

  it('汉字与拉丁字母 / 数字的交界处会切词', () => {
    assert.equal(findMatchedKeyword('Java开发工程师', ['Java'], exact), 'Java')
    assert.equal(findMatchedKeyword('Java / 开发', ['开发'], exact), '开发')
    assert.equal(findMatchedKeyword('Vue3开发', ['Vue3'], exact), 'Vue3')
    assert.equal(findMatchedKeyword('3-5年经验', ['5'], exact), '5')
    // 交界处已经切开，所以「开发」在「开发工程师」里属于拼接命中，不算整词
    assert.equal(findMatchedKeyword('Java开发工程师', ['开发'], exact), null)
    assert.equal(findMatchedKeyword('Java开发工程师', ['Java开发'], exact), null)
  })

  it('同样忽略大小写与空白', () => {
    assert.equal(findMatchedKeyword('JAVA 开发', ['java'], exact), 'java')
    assert.equal(findMatchedKeyword('软 通 动 力', ['软通动力'], exact), '软通动力')
  })

  it('已知取舍：英文短语会被视作一个整体（需要宽松匹配请用 contains）', () => {
    assert.equal(findMatchedKeyword('Senior Front End Developer', ['front'], exact), null)
    assert.equal(
      findMatchedKeyword('Senior Front End Developer', ['SeniorFrontEndDeveloper'], exact),
      'SeniorFrontEndDeveloper'
    )
  })

  it('空文本 / 空关键词列表返回 null', () => {
    assert.equal(findMatchedKeyword('', ['前端'], exact), null)
    assert.equal(findMatchedKeyword(null, ['前端'], exact), null)
    assert.equal(findMatchedKeyword('前端', [], exact), null)
    assert.equal(findMatchedKeyword('前端', null, exact), null)
  })

  it('不传 matchMode 时行为与 contains 完全一致（向后兼容）', () => {
    assert.equal(findMatchedKeyword('资深前端', ['前端']), '前端')
    assert.equal(findMatchedKeyword('资深前端', ['前端'], {}), '前端')
    assert.equal(findMatchedKeyword('资深前端', ['前端'], { matchMode: undefined }), '前端')
  })
})

describe('匹配模式在匹配器上的表现', () => {
  it('matcher 暴露归一化后的 matchMode，未配置时为 contains', () => {
    assert.equal(createJobBlockMatcher({ keywordList: ['外包'] }).matchMode, 'contains')
    assert.equal(createCompanyBlockMatcher({ keywordList: ['外包'], matchMode: 'exact' }).matchMode, 'exact')
    assert.equal(createJobBlockMatcher({ keywordList: ['外包'], matchMode: '瞎写' }).matchMode, 'contains')
  })

  it('职位 matcher：exact 下「资深前端」不会因「前端」被屏蔽', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['前端'], matchMode: 'exact' })
    assert.equal(
      matcher.test({ jobName: '资深前端', positionName: '前端开发', postDescription: '负责前端相关工作' }).matched,
      false
    )
    assert.equal(matcher.test({ jobName: '前端', positionName: '', postDescription: '' }).matched, true)
  })

  it('职位 matcher：列表预筛同样遵守 exact', () => {
    const matcher = createJobBlockMatcher({ keywordList: ['外包'], matchMode: 'exact' })
    assert.equal(matcher.testListItem({ jobName: '外包专员' }).matched, false)
    assert.equal(matcher.testListItem({ jobName: '外包' }).matched, true)
  })

  it('排除词与屏蔽词共用同一个模式：被标点分开时两者都能整体命中', () => {
    const matcher = createJobBlockMatcher({
      keywordList: ['外包'],
      excludeKeywordList: ['非外包'],
      matchMode: 'exact',
      matchFields: ['jobName']
    })
    // 屏蔽词整体一致 -> 命中
    assert.equal(matcher.test({ jobName: '外包' }).matched, true)
    // 同一字段里屏蔽词与排除词都是整词 -> 放行，并带出排除词用于解释
    assert.deepEqual(matcher.test({ jobName: '外包 / 非外包' }), {
      matched: false,
      field: null,
      fieldLabel: null,
      keyword: null,
      excludedKeyword: '非外包'
    })
    // 精准模式下「非外包团队」既不是屏蔽词的整词（不命中），也就没有排除词可带出
    assert.deepEqual(matcher.test({ jobName: '非外包团队' }), {
      matched: false,
      field: null,
      fieldLabel: null,
      keyword: null,
      excludedKeyword: null
    })
    assert.equal(matcher.test({ jobName: '人力外包专员' }).matched, false)
  })

  it('公司 matcher：exact 需要公司名整体一致', () => {
    const matcher = createCompanyBlockMatcher({ keywordList: ['软通动力'], matchMode: 'exact' })
    assert.equal(matcher.test('软通动力').matched, true)
    assert.equal(matcher.test('软通动力信息技术有限公司').matched, false)
  })

  it('describe 只在非默认模式下标注匹配模式（保持既有日志文案稳定）', () => {
    assert.equal(
      createCompanyBlockMatcher({ keywordList: ['外包'], matchMode: 'contains' }).describe(),
      '关键词：外包'
    )
    assert.equal(
      createCompanyBlockMatcher({ keywordList: ['外包'], matchMode: 'exact' }).describe(),
      '关键词：外包；匹配模式：精准匹配'
    )
    assert.equal(
      createJobBlockMatcher({ keywordList: ['外包'], matchMode: 'exact' }).describe(),
      '关键词：外包；匹配模式：精准匹配；匹配范围：职位名称 / 职位类型 / 职位描述'
    )
    assert.equal(
      createJobBlockMatcher({
        keywordList: ['外包'],
        excludeKeywordList: ['非外包'],
        matchMode: 'exact'
      }).describe(),
      '关键词：外包；匹配模式：精准匹配；匹配范围：职位名称 / 职位类型 / 职位描述；排除词：非外包'
    )
  })
})

describe('resolveBlockFilterConfig 透传匹配模式', () => {
  it('匹配模式与关键词同源（跟着 fieldsForUseCommonConfig 开关走）', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: {
        blockJobKeywordList: ['外包'],
        blockJobKeywordMatchMode: 'contains',
        blockCompanyKeywordList: ['软通动力'],
        blockCompanyKeywordMatchMode: 'exact',
        fieldsForUseCommonConfig: { blockJobKeyword: true }
      },
      commonConfig: {
        blockJobKeywordList: ['销售'],
        blockJobKeywordMatchMode: 'exact',
        blockCompanyKeywordMatchMode: 'contains'
      }
    })
    // 职位屏蔽走公共配置 -> 取公共配置的模式
    assert.equal(resolved.job.matchMode, 'exact')
    // 公司屏蔽没开开关 -> 仍取 boss.json 的模式
    assert.equal(resolved.company.matchMode, 'exact')
    assert.deepEqual(resolved.job.keywordList, ['销售'])
    assert.deepEqual(resolved.company.keywordList, ['软通动力'])
  })

  it('未配置时回落到默认模式', () => {
    const resolved = resolveBlockFilterConfig({ bossConfig: { blockJobKeywordList: ['外包'] } })
    assert.equal(resolved.job.matchMode, DEFAULT_KEYWORD_MATCH_MODE)
    assert.equal(resolved.company.matchMode, DEFAULT_KEYWORD_MATCH_MODE)
  })

  it('非法值透传给匹配器，由匹配器统一回落（单一归一化点）', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: { blockJobKeywordList: ['外包'], blockJobKeywordMatchMode: '瞎写' }
    })
    assert.equal(resolved.job.matchMode, '瞎写')
    assert.equal(createJobBlockMatcher(resolved.job).matchMode, 'contains')
  })

  it('端到端：exact 模式下屏蔽「外包」但放行整体为「非外包」的职位', () => {
    const resolved = resolveBlockFilterConfig({
      bossConfig: {
        blockJobKeywordList: ['外包'],
        blockJobKeywordExcludeList: ['非外包'],
        blockJobKeywordMatchMode: 'exact'
      }
    })
    const matcher = createJobBlockMatcher(resolved.job)
    assert.equal(matcher.test({ jobName: '外包', postDescription: '' }).matched, true)
    assert.equal(matcher.test({ jobName: '非外包', postDescription: '' }).matched, false)
    assert.equal(matcher.test({ jobName: '资深外包专员', postDescription: '' }).matched, false)
  })
})
