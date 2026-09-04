<template>
  <n-modal
    :show="cloudUploadStore.panelVisible"
    preset="card"
    class="cloud-upload-modal"
    :style="{ width: '560px' }"
    :bordered="false"
    :segmented="false"
    :mask-closable="true"
    @update:show="handleUpdateShow"
  >
    <template #header>
      <div class="modal-header">
        <div class="modal-title">
          <SvgIcon :size="20" name="Cloud" />
          <n-text strong>云盘上传</n-text>
        </div>
        <n-text depth="3" class="modal-summary">{{ summaryText }}</n-text>
      </div>
    </template>

    <div class="modal-body">
      <!-- 进行中的任务 -->
      <template v-if="runningTasks.length">
        <div class="section-title">
          <n-text strong>进行中</n-text>
          <n-tag size="small" type="info" :bordered="false" round>{{ runningTasks.length }}</n-tag>
        </div>
        <div class="task-list">
          <div v-for="task in runningTasks" :key="task.id" class="task-item running">
            <div class="task-line">
              <div class="task-info">
                <SvgIcon name="Time" :depth="3" />
                <n-text class="task-name">{{ task.displayName }}</n-text>
              </div>
              <n-tag size="small" type="info" :bordered="false" round>{{ statusText(task) }}</n-tag>
            </div>
            <!-- 下载歌曲后的任务：显示两步进度 -->
            <template v-if="task.kind === 'download'">
              <div class="progress-item">
                <div class="progress-label">
                  <n-text depth="3" style="font-size: 12px">下载音频</n-text>
                  <n-text depth="3" style="font-size: 12px">{{ task.downProgress }}%</n-text>
                </div>
                <n-progress
                  type="line"
                  :percentage="task.downProgress"
                  :show-indicator="false"
                  :height="4"
                />
              </div>
              <div class="progress-item">
                <div class="progress-label">
                  <n-text depth="3" style="font-size: 12px">上传至云盘</n-text>
                  <n-text depth="3" style="font-size: 12px">{{ task.upProgress }}%</n-text>
                </div>
                <n-progress
                  type="line"
                  :percentage="task.upProgress"
                  :show-indicator="false"
                  :height="4"
                />
              </div>
            </template>
            <!-- 本地文件任务：只有上传进度 -->
            <template v-else>
              <div class="progress-item">
                <div class="progress-label">
                  <n-text depth="3" style="font-size: 12px">上传至云盘</n-text>
                  <n-text depth="3" style="font-size: 12px">{{ task.upProgress }}%</n-text>
                </div>
                <n-progress
                  type="line"
                  :percentage="task.upProgress"
                  :show-indicator="false"
                  :height="4"
                />
              </div>
            </template>
            <div class="task-actions">
              <n-button size="tiny" quaternary @click="cancelTask(task.id)">
                <template #icon><SvgIcon name="Close" /></template>
                取消
              </n-button>
            </div>
          </div>
        </div>
      </template>

      <!-- 已完成的任务 -->
      <template v-if="finishedTasks.length">
        <div class="section-title">
          <n-text strong>已完成</n-text>
          <n-tag size="small" type="default" :bordered="false" round>
            {{ finishedTasks.length }}
          </n-tag>
        </div>
        <div class="task-list">
          <div v-for="task in finishedTasks" :key="task.id" class="task-item finished">
            <div class="task-line">
              <div class="task-info">
                <SvgIcon
                  :name="statusIcon(task)"
                  :depth="task.status === 'error' ? undefined : 3"
                  :class="`status-icon status-${task.status}`"
                />
                <n-text class="task-name" :depth="task.status === 'canceled' ? 3 : 2">
                  {{ task.displayName }}
                </n-text>
              </div>
              <n-flex :size="8" align="center">
                <n-text depth="3" style="font-size: 12px">{{ formatTime(task.finishedAt) }}</n-text>
                <n-tag :type="statusTagType(task)" size="small" :bordered="false" round>
                  {{ statusText(task) }}
                </n-tag>
              </n-flex>
            </div>
            <!-- 失败原因 -->
            <n-text v-if="task.status === 'error'" type="error" class="error-msg">
              {{ task.errorMessage }}
            </n-text>
          </div>
        </div>
      </template>

      <!-- 空状态 -->
      <n-empty v-if="!cloudUploadStore.tasks.length" description="暂无上传记录" size="small" />
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button size="small" quaternary :disabled="!finishedTasks.length" @click="clearFinished">
          <template #icon><SvgIcon name="DeleteSweep" /></template>
          清空已完成
        </n-button>
        <n-button size="small" type="primary" secondary @click="cloudUploadStore.closePanel">
          关闭
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { useCloudUploadStore } from "@/stores";
import type { CloudUploadTask } from "@/stores/cloudUpload";

const cloudUploadStore = useCloudUploadStore();

// 进行中任务
const runningTasks = computed(() =>
  cloudUploadStore.tasks.filter((t) => t.status === "pending" || t.status === "uploading"),
);

// 已完成任务
const finishedTasks = computed(() =>
  cloudUploadStore.tasks.filter((t) => t.status !== "pending" && t.status !== "uploading"),
);

// 汇总文案
const summaryText = computed(() => {
  const success = cloudUploadStore.tasks.filter((t) => t.status === "success").length;
  const error = cloudUploadStore.tasks.filter((t) => t.status === "error").length;
  const running = runningTasks.value.length;
  return `进行中 ${running} · 成功 ${success} · 失败 ${error}`;
});

// 弹窗关闭回调
const handleUpdateShow = (show: boolean) => {
  if (!show) cloudUploadStore.closePanel();
};

// 取消单个任务
const cancelTask = (id: number) => {
  cloudUploadStore.cancelTask(id);
};

// 清空已完成记录
const clearFinished = () => {
  cloudUploadStore.clearFinished();
};

// 任务状态图标
const statusIcon = (task: CloudUploadTask): string => {
  switch (task.status) {
    case "success":
      return "Check";
    case "error":
      return "Close";
    case "canceled":
      return "Time";
    default:
      return "Time";
  }
};

// 状态标签类型
const statusTagType = (task: CloudUploadTask): "success" | "error" | "default" => {
  switch (task.status) {
    case "success":
      return "success";
    case "error":
      return "error";
    default:
      return "default";
  }
};

// 任务状态文案
const statusText = (task: CloudUploadTask): string => {
  switch (task.status) {
    case "pending":
      return "等待上传";
    case "uploading":
      if (task.kind === "download" && task.downProgress < 100) return "正在下载...";
      return "正在上传...";
    case "success":
      return "上传成功";
    case "error":
      return "上传失败";
    case "canceled":
      return "已取消";
    default:
      return "";
  }
};

// 格式化完成时间
const formatTime = (timestamp?: number): string => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
</script>

<style scoped lang="scss">
.cloud-upload-modal {
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;

    .modal-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .task-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 8px;
    background-color: rgba(var(--background), 0.06);

    &.finished {
      background-color: transparent;
      border: 1px solid rgba(var(--background), 0.12);
    }

    .task-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .task-info {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    .task-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-icon {
      font-size: 16px;

      &.status-success {
        color: var(--success-color, #18a058);
      }
      &.status-error {
        color: var(--error-color, #d03050);
      }
    }

    .error-msg {
      font-size: 12px;
      word-break: break-all;
    }

    .progress-item {
      display: flex;
      flex-direction: column;
      gap: 4px;

      .progress-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
    }

    .task-actions {
      display: flex;
      justify-content: flex-end;
    }
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
