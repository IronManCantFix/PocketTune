<template>
  <!-- 未投送：投送入口图标 -->
  <div v-if="!dlnaStore.isCasting" class="cast-btn" @click.stop="handleOpenCast">
    <SvgIcon name="RssFeed" />
  </div>

  <!-- 紧凑模式：投送态只显示高亮图标，避免窄区域（底部播放条）被状态条撑开 -->
  <div v-else-if="compact" class="cast-btn cast-active" @click.stop="handleOpenCast">
    <SvgIcon name="RssFeed" />
  </div>

  <!-- 已投送：投送状态条 -->
  <div v-else class="cast-bar" @click.stop>
    <SvgIcon name="RssFeed" :size="16" class="cast-active-icon" />
    <span class="cast-name" :title="dlnaStore.activeDevice?.name ?? '电视'">
      {{ dlnaStore.activeDevice?.name ?? "电视" }}
    </span>
    <div class="cast-actions">
      <n-button
        size="tiny"
        quaternary
        :focusable="false"
        :keyboard="false"
        @click.stop="handleTogglePlay"
      >
        <SvgIcon :name="dlnaStore.tvPlaying ? 'Pause' : 'Play'" :size="14" />
      </n-button>
      <n-button
        size="tiny"
        quaternary
        :focusable="false"
        :keyboard="false"
        @click.stop="handleDisconnect"
      >
        <SvgIcon name="Close" :size="14" />
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDlnaStore, setupDlnaWatchers } from "@/stores";
import { openCastModal } from "@/utils/modal";

// 紧凑模式：窄区域（底部播放条）下投送态仅显示高亮图标，防止状态条撑开布局
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const dlnaStore = useDlnaStore();

// 打开投送弹窗
const handleOpenCast = () => {
  void openCastModal();
};

// 投送态播放/暂停（作用于电视）
const handleTogglePlay = () => {
  void dlnaStore.togglePlay();
};

// 断开投送：停止电视，并按投送前状态恢复本地播放（由 store 统一处理）
const handleDisconnect = async () => {
  await dlnaStore.disconnect();
};

// 投送成功后本地静音由 store（castTo/castUrl）统一处理，此处不再重复补偿

// 挂载时激活投送全局联动（模块级单例：切歌联动 + 本地静音拦截 + 刷新恢复投送态）
onMounted(() => {
  setupDlnaWatchers();
  // 刷新后恢复投送态：直接启动轮询（watch 对已恢复的初始值不触发）
  if (dlnaStore.isCasting) {
    startPolling();
  }
});

// 投送态下周期性轮询电视播放状态/进度
let pollTimer: number | null = null;
const startPolling = () => {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void dlnaStore.syncPosition();
  }, 1500);
};
const stopPolling = () => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};

// 投送态开启时启动轮询，关闭时停止
watch(
  () => dlnaStore.isCasting,
  (casting) => {
    if (casting) {
      startPolling();
    } else {
      stopPolling();
    }
  },
);

onUnmounted(stopPolling);
</script>

<style scoped lang="scss">
.cast-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background-color 0.3s,
    transform 0.3s;

  .n-icon {
    font-size: 22px;
    color: var(--primary-hex);
  }

  &:hover {
    transform: scale(1.1);
    background-color: rgba(var(--primary), 0.28);
  }
}

// 紧凑模式投送态：高亮图标，占位与未投送一致
.cast-btn.cast-active {
  .n-icon {
    color: var(--primary-hex);
    opacity: 1;
  }
  &::after {
    content: "";
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--primary-hex);
  }
}

.cast-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border: 1px solid rgba(var(--primary), 0.35);
  border-radius: 999px;
  background-color: rgba(var(--primary), 0.12);

  .cast-active-icon {
    color: var(--primary-hex);
    flex-shrink: 0;
  }

  .cast-name {
    font-size: 12px;
    color: var(--primary-hex);
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cast-actions {
    display: flex;
    align-items: center;
    gap: 2px;

    :deep(.n-button) {
      color: var(--primary-hex);
    }
  }
}

// 移动端（全屏播放器顶部栏）适配：按钮圆形、状态条紧凑
.cast-btn.cast-mobile {
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;

  .n-icon {
    color: rgb(var(--main-cover-color));
    opacity: 0.8;
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.1);
  }
}

.cast-bar.cast-mobile {
  padding: 4px 6px 4px 10px;
  border-color: rgba(255, 255, 255, 0.35);
  background-color: rgba(0, 0, 0, 0.25);

  .cast-active-icon,
  .cast-name {
    color: rgb(var(--main-cover-color));
  }

  .cast-name {
    max-width: 56px;
  }
}

// 窄窗口下（PC 展开播放器）投送状态条降级为紧凑图标，防止右侧功能区溢出挤压进度条
@media (max-width: 1200px) {
  .cast-bar:not(.cast-mobile) {
    padding: 6px 6px 6px 8px;

    .cast-name {
      display: none;
    }
  }
}
</style>
