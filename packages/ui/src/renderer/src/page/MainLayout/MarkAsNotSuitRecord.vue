<template>
  <div class="page-wrap flex flex-col of-hidden">
    <div v-loading="isTableLoading" class="flex-1 of-hidden">
      <div ref="tableContainerEl" class="h-100% of-hidden">
        <ElTable
          ref="tableRef"
          :max-height="tableMaxHeight"
          :data="tableData"
          :row-key="getRowKey"
          size="small"
          table-layout="auto"
          highlight-current-row
        >
          <ElTableColumn prop="companyName" label="公司" />
          <ElTableColumn prop="jobName" label="职位名称" />
          <ElTableColumn prop="positionName" label="职位分类" />
          <ElTableColumn
            prop="date"
            label="标记时间"
            :formatter="
              (_row, _col, val) => transformUtcDateToLocalDate(val).format('YYYY-MM-DD HH:mm:ss')
            "
          />
          <ElTableColumn prop="bossName" label="BOSS" width="64" />
          <ElTableColumn prop="markReason" label="标记原因" width="250">
            <template #default="{ row }">
              <strong>{{ getMarkAsNotSuitReasonText(row.markReason) }}</strong>
              <pre
                v-for="(line, lineIndex) in getReasonDetailLines(row)"
                :key="lineIndex"
                class="m-0 of-auto"
                >{{ line }}</pre
              >
            </template>
          </ElTableColumn>
          <ElTableColumn prop="experienceName" label="工作经验" />
          <ElTableColumn
            label="薪资"
            :formatter="
              (row, _col, _val) =>
                `${row.salaryLow}-${row.salaryHigh}k` +
                (row.salaryMonth ? `* ${row.salaryMonth}薪` : '')
            "
          />
          <ElTableColumn label="职位信息" fixed="right" :width="120">
            <template #default="{ row }">
              <ElButton
                link
                type="primary"
                size="small"
                @click="handleViewJobSnapshotButtonClick(row)"
                >快照</ElButton
              >
              <ElButton
                link
                type="primary"
                size="small"
                @click="handleViewJobOnlineButtonClick(row.encryptJobId)"
                >线上</ElButton
              >
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </div>
    <div class="flex flex-0 flex-justify-between pt10px pb10px">
      <div class="w100px">
        <el-button
          :loading="isTableLoading"
          size="small"
          @click="
            () => {
              gtagRenderer('mansr_refresh_clicked')
              getMarkAsNotSuitRecord()
            }
          "
          >刷新</el-button
        >
      </div>
      <ElPagination
        v-model:current-page="pagination.pageNo"
        v-model:page-size="pagination.pageSize"
        :page-sizes="pageSizeList"
        small
        :disabled="isTableLoading"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pagination.totalItemCount"
        @size-change="getMarkAsNotSuitRecord"
        @current-change="getMarkAsNotSuitRecord"
      />
      <div class="w100px" />
    </div>
    <ElDrawer v-model="drawVisibleModelValue" size="400px">
      <JobInfoSnapshot
        v-if="selectedJobInfoForViewSnapshot"
        :job-info="selectedJobInfoForViewSnapshot"
        scene="markAsNotSuitRecord"
        @closed="
          () => {
            gtagRenderer('mansr_closed')
            selectedJobInfoForViewSnapshot = null
          }
        "
      />
    </ElDrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, h } from 'vue'
import { ElTable, ElTableColumn, ElButton, ElPagination, ElDrawer } from 'element-plus'
import { type VMarkAsNotSuitLog } from '@geekgeekrun/sqlite-plugin/src/entity/VMarkAsNotSuitLog'
import { PageReq, PagedRes } from '../../../../common/types/pagination'
import JobInfoSnapshot from '../../features/JobInfoSnapshot/index.vue'
import { MarkAsNotSuitReason, getMarkAsNotSuitReasonText } from '@geekgeekrun/sqlite-plugin/src/enums'
import { JOB_KEYWORD_MATCH_FIELDS } from '@geekgeekrun/geek-auto-start-chat-with-boss/job-filter.mjs'
import { transformUtcDateToLocalDate } from '@geekgeekrun/utils/date.mjs'
import { gtagRenderer } from '@renderer/utils/gtag'

const tableData = ref<VMarkAsNotSuitLog[]>([])
const pageSizeList = ref<number[]>([100, 200, 300, 400])
const pagination = ref<Omit<PageReq & PagedRes<unknown>, 'data'>>({
  pageNo: 1,
  pageSize: pageSizeList.value[0],
  totalItemCount: 0
})
const getRowKey = (row: VMarkAsNotSuitLog) => {
  return `${row.encryptJobId}@${row.date}`
}
const tableRef = ref<InstanceType<typeof ElTable>>()
const isTableLoading = ref(false)
async function getMarkAsNotSuitRecord() {
  try {
    gtagRenderer('mansr_request_sent', {
      page_no: pagination.value.pageNo,
      page_size: pagination.value.pageSize
    })
    isTableLoading.value = true
    const { data: res } = (await electron.ipcRenderer.invoke('get-mark-as-not-suit-record', {
      pageNo: pagination.value.pageNo,
      pageSize: pagination.value.pageSize
    })) as { data: PagedRes<VMarkAsNotSuitLog> }
    tableData.value = res.data
    pagination.value = {
      totalItemCount: res.totalItemCount,
      pageNo: res.pageNo,
      pageSize: pagination.value.pageSize
    }
    gtagRenderer('mansr_request_success', {
      page_no: pagination.value.pageNo,
      page_size: pagination.value.pageSize
    })
  } catch (err) {
    gtagRenderer('mansr_request_error', {
      err,
      page_no: pagination.value.pageNo,
      page_size: pagination.value.pageSize
    })
    console.log(err)
    tableData.value = []
  } finally {
    tableRef.value?.setScrollTop(0)
    isTableLoading.value = false
  }
}

getMarkAsNotSuitRecord()

const tableMaxHeight = ref<number | undefined>(undefined)
const tableContainerEl = ref<HTMLElement>()
const setTableMaxHeight = () =>
  (tableMaxHeight.value = tableContainerEl.value?.clientHeight ?? undefined)
onMounted(() => {
  setTableMaxHeight()
  const ro = new ResizeObserver(() => setTableMaxHeight())
  ro.observe(tableContainerEl.value!)
  onBeforeUnmount(() => {
    ro.disconnect()
  })
})

async function handleViewJobOnlineButtonClick(encryptJobId: string) {
  gtagRenderer('view_job_online_button_clicked')
  return await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
    url: `https://www.zhipin.com/job_detail/${encryptJobId}.html`
  })
}

const drawVisibleModelValue = ref(false)
const selectedJobInfoForViewSnapshot = ref<VMarkAsNotSuitLog | null>(null)

function handleViewJobSnapshotButtonClick(record: VMarkAsNotSuitLog) {
  gtagRenderer('view_job_snapshot_button_clicked')
  selectedJobInfoForViewSnapshot.value = record
  drawVisibleModelValue.value = true
}

/** extInfo 是历史遗留的 JSON 字符串字段，可能为空或非法，解析失败时按“没有补充信息”处理 */
function parseExtInfo(row: VMarkAsNotSuitLog) {
  try {
    return JSON.parse(row.extInfo)
  } catch {
    return null
  }
}

const jobKeywordMatchFieldLabelMap = Object.fromEntries(
  JOB_KEYWORD_MATCH_FIELDS.map((it) => [it.key, it.label])
)

/**
 * “标记原因”下方展示的补充说明，回答“为什么被标记”。
 * 关键词屏蔽会把命中的关键词与字段写进 extInfo，这里如实展示，便于排查误伤。
 */
function getReasonDetailLines(row: VMarkAsNotSuitLog): string[] {
  const extInfo = parseExtInfo(row)
  const lines: Array<string | null | undefined> = []
  switch (row.markReason) {
    case MarkAsNotSuitReason.BOSS_INACTIVE: {
      lines.push(extInfo?.bossActiveTimeDesc && `BOSS活跃情况：${extInfo.bossActiveTimeDesc}`)
      break
    }
    case MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT: {
      lines.push(extInfo?.salaryDesc && `薪资：${extInfo.salaryDesc}`)
      break
    }
    case MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT: {
      lines.push(extInfo?.matchedKeyword && `命中关键词：${extInfo.matchedKeyword}`)
      break
    }
    case MarkAsNotSuitReason.JOB_KEYWORD_NOT_SUIT: {
      const fieldLabel = jobKeywordMatchFieldLabelMap[extInfo?.matchedField]
      lines.push(
        extInfo?.matchedKeyword &&
          `命中关键词：${extInfo.matchedKeyword}${fieldLabel ? `（${fieldLabel}）` : ''}`
      )
      break
    }
    default: {
      break
    }
  }
  lines.push(extInfo?.chosenReasonInUi?.text && `BOSS选项内容：${extInfo.chosenReasonInUi.text}`)
  return lines.filter((it): it is string => Boolean(it))
}
</script>

<style scoped lang="scss">
.page-wrap {
  margin: 0 auto;
  max-width: 1000px;
  max-height: 100vh;
  overflow: hidden;
  padding-left: 20px;
  padding-top: 20px;
  :deep(.el-drawer) {
    .el-drawer__header {
      padding: 16px 20px;
      margin-bottom: 0;
    }
    .el-drawer__body {
      padding: 0;
      margin: 0 0 20px 20px;
      padding-right: 20px;
    }
  }
}
</style>
