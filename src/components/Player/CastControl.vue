<template>
  <!-- 未投送：投送入口图标 -->
  <div v-if="!dlnaStore.isCasting" class="cast-btn" @click.stop="handleOpenCast">
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
import { usePlayerController } from "@/core/player/PlayerController";
import { useMusicStore, useStatusStore, useDlnaStore } from "@/stores";
import { openCastModal } from "@/utils/modal";

const dlnaStore = useDlnaStore();
const player = usePlayerController();
const musicStore = useMusicStore();
const statusStore = useStatusStore();

// 打开投送弹窗
const handleOpenCast = () => {
  void openCastModal();
};

// 投送态播放/暂停（作用于电视）
const handleTogglePlay = () => {
  void dlnaStore.togglePlay();
};

// 断开投送并恢复本地播放
const handleDisconnect = async () => {
  await dlnaStore.disconnect();
  // 恢复本地播放（若投送前本地在播放，从暂停点继续）
  if (statusStore.playStatus) {
    void player.play();
  }
};

// 投送成功后暂停本地，由电视独占出声
watch(
  () => dlnaStore.isCasting,
  (casting, prev) => {
    if (casting && !prev && statusStore.playStatus) {
      player.pause();
    }
  },
);

// 切歌联动：投送态下自动把新歌投送到电视，并保持本地暂停
watch(
  () => musicStore.playSong.id,
  (songId, prev) => {
    if (songId == null) return;
    if (prev == null || songId === prev) return;
    if (dlnaStore.isCasting) {
      // 重投电视
      void dlnaStore.handleSongChange(songId);
      // 本地可能在切歌时自动播放，补偿暂停
      window.setTimeout(() => {
        if (dlnaStore.isCasting && statusStore.playStatus) {
          player.pause();
        }
      }, 500);
    }
  },
);

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
</style>
