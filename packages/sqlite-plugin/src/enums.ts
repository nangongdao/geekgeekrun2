export enum MarkAsNotSuitReason {
  UNKNOWN = 0,
  BOSS_INACTIVE = 1,
  USER_MANUAL_OPERATION_WITH_UNKNOWN_REASON = 2,
  JOB_NOT_SUIT = 3,
  JOB_CITY_NOT_SUIT = 4,
  JOB_WORK_EXP_NOT_SUIT = 5,
  JOB_SALARY_NOT_SUIT = 6,
  COMPANY_NAME_NOT_SUIT = 7,
  JOB_KEYWORD_NOT_SUIT = 8,
}

/**
 * 不合适原因的中文文案。
 *
 * 界面一律从这里取文案，不再各自维护一份 map：
 * 以前每新增一个枚举值，都要记得去 UI 里补一条，漏了就显示空白。
 */
export const MARK_AS_NOT_SUIT_REASON_TEXT_MAP: Record<MarkAsNotSuitReason, string> = {
  [MarkAsNotSuitReason.UNKNOWN]: '未知',
  [MarkAsNotSuitReason.BOSS_INACTIVE]: 'BOSS不活跃',
  [MarkAsNotSuitReason.USER_MANUAL_OPERATION_WITH_UNKNOWN_REASON]: '手动标记不合适',
  [MarkAsNotSuitReason.JOB_NOT_SUIT]: '职位不合适',
  [MarkAsNotSuitReason.JOB_CITY_NOT_SUIT]: '工作地不合适',
  [MarkAsNotSuitReason.JOB_WORK_EXP_NOT_SUIT]: '工作经验不合适',
  [MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT]: '薪资不合适',
  [MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT]: '公司名称不匹配',
  [MarkAsNotSuitReason.JOB_KEYWORD_NOT_SUIT]: '职位关键词命中',
}

export const getMarkAsNotSuitReasonText = (
  reason: MarkAsNotSuitReason | number | undefined | null
): string => {
  return MARK_AS_NOT_SUIT_REASON_TEXT_MAP[reason as MarkAsNotSuitReason] ?? '未知原因'
}

export enum MarkAsNotSuitOp {
  MARK_AS_NOT_SUIT_ON_BOSS = 1,
  MARK_AS_NOT_SUIT_ON_LOCAL = 2,
  NO_OP = 3
}

export enum StrategyScopeOptionWhenMarkJobNotMatch {
  ALL_JOB = 1,
  ONLY_COMPANY_MATCHED_JOB = 2
}

export enum SalaryCalculateWay {
  MONTH_SALARY = 1,
  ANNUAL_PACKAGE = 2,
}

export enum JobDetailRegExpMatchLogic {
  EVERY = 1,
  SOME = 2,
}

export enum JobSource {
  expect = 1,
  recommend = 2,
  search = 3,
}

export enum CombineRecommendJobFilterType {
  ANY_COMBINE = 1,
  STATIC_COMBINE = 2,
}

export enum JobHireStatus {
  HIRING = 1,
  CLOSED = 2,
  DELETED = 3,
}