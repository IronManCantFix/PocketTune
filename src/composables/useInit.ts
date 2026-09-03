import { mediaSessionManager } from "@/core/player/MediaSessionManager";
import { usePlayerController } from "@/core/player/PlayerController";
import { setUnblockSources } from "@/api/song";
import { useDataStore, useSettingStore, useStatusStore } from "@/stores";
import { printVersion } from "@/utils/log";
import { onMounted, watch } from "vue";

/**
 * 应用初始化时需要执行的操作
 */
export const useInit = () => {
  // init pinia-data
  const dataStore = useDataStore();
  const statusStore = useStatusStore();
  const settingStore = useSettingStore();

  const player = usePlayerController();

  onMounted(async () => {
    // 检查并执行设置迁移
    settingStore.checkAndMigrate();
    // 打印版本信息
    printVersion();
    // 加载数据
    await dataStore.loadData();
    // 初始化 MediaSession
    mediaSessionManager.init();
    // 初始化播放器
    player.playSong({
      autoPlay: settingStore.autoPlay,
      seek: settingStore.memoryLastSeek ? statusStore.currentTime : 0,
    });
    // 同步播放模式
    player.playModeSyncIpc();
    // 初始化自动关闭定时器
    if (statusStore.autoClose.enable) {
      const { endTime, time } = statusStore.autoClose;
      const now = Date.now();
      if (endTime > now) {
        // 计算真实剩余时间
        const realRemainTime = Math.ceil((endTime - now) / 1000);
        player.startAutoCloseTimer(time, realRemainTime);
      } else {
        // 定时器已过期，重置状态
        statusStore.autoClose.enable = false;
        statusStore.autoClose.remainTime = time * 60;
        statusStore.autoClose.endTime = 0;
      }
    }

    // 监听设置变化以更新 ReplayGain
    watch(
      () => [settingStore.enableReplayGain, settingStore.replayGainMode],
      () => player.applyReplayGain(),
    );

    // 回填服务端解灰音源设置（服务端重启后自动恢复）
    if (settingStore.unblockSources.length > 0) {
      setUnblockSources(settingStore.unblockSources).catch(() => {
        // 服务端不可达时静默跳过，设置页操作时会重试
      });
    }
  });
};
