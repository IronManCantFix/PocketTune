<template>
  <n-flex :size="8" align="center" class="right-menu">
    <!-- 音质 -->
    <template v-if="settingStore.showPlayerQuality">
      <n-popselect
        v-if="isOnlineSong"
        v-model:show="showQualityPopover"
        :value="currentPlayingLevel"
        :options="qualityOptions"
        trigger="manual"
        placement="top"
        @update:value="handleQualitySelect"
        @clickoutside="handleClickOutside"
      >
        <template #header>
          <n-flex class="quality-title" size="small" vertical>
            <span class="title">音质切换</span>
            <span class="tip">以账号具体权限为准</span>
          </n-flex>
        </template>
        <div ref="qualityTagRef">
          <n-tag
            class="quality-tag hidden"
            type="primary"
            size="small"
            @click.stop="handleQualityClick"
          >
            {{ getQualityName(statusStore.songQuality) }}
          </n-tag>
        </div>
      </n-popselect>
      <n-popover v-else trigger="hover" placement="top" :show-arrow="false">
        <template #trigger>
          <n-tag class="quality-tag hidden" type="primary" size="small">
            {{ getQualityName(statusStore.songQuality) }}
          </n-tag>
        </template>
        <span>当前歌曲不支持切换音质</span>
      </n-popover>
    </template>
    <!-- 其他控制 -->
    <n-dropdown
      v-if="settingStore.fullscreenPlayerElements.moreSettings"
      :options="controlsOptions"
      :show-arrow="false"
      @select="handleControls"
    >
      <div class="menu-icon hidden">
        <SvgIcon name="Controls" />
      </div>
    </n-dropdown>
    <!-- 音量 -->
    <n-popover :show-arrow="false" :style="{ padding: 0 }">
      <template #trigger>
        <div
          class="menu-icon hidden"
          @click.stop="handleVolumeIconClick"
          @wheel="handleVolumeWheel"
        >
          <SvgIcon :name="volumeIcon" />
        </div>
      </template>
      <div class="volume-change" @wheel="handleVolumeWheel">
        <n-slider
          v-model:value="volumeModel"
          :tooltip="false"
          :min="0"
          :max="1"
          :step="0.01"
          vertical
        />
        <n-text class="slider-num hidden">{{ Math.round(volumeModel * 100) }}%</n-text>
      </div>
    </n-popover>
    <!-- 播放列表 -->
    <n-badge
      v-if="!statusStore.personalFmMode"
      :value="dataStore.playList?.length ?? 0"
      :show="settingStore.showPlaylistCount"
      :max="9999"
      :style="{
        marginRight: settingStore.showPlaylistCount ? '12px' : null,
      }"
    >
      <div class="menu-icon" @click.stop="statusStore.playListShow = !statusStore.playListShow">
        <SvgIcon name="PlayList" />
      </div>
    </n-badge>
  </n-flex>
</template>

<script setup lang="ts">
import { usePlayerController } from "@/core/player/PlayerController";
import {
  useDataStore,
  useSettingStore,
  useStatusStore,
  useMusicStore,
  useDlnaStore,
} from "@/stores";
import { renderIcon } from "@/utils/helper";
import { openAutoClose, openChangeRate, openEqualizer, openABLoop } from "@/utils/modal";
import { useAudioManager } from "@/core/player/AudioManager";
import type { DropdownOption } from "naive-ui";
import { useQualityControl } from "@/composables/useQualityControl";

const dataStore = useDataStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const musicStore = useMusicStore();
const dlnaStore = useDlnaStore();
const player = usePlayerController();

const {
  currentPlayingLevel,
  qualityOptions,
  loadQualities,
  handleQualitySelect,
  getQualityName,
  isOnlineSong,
} = useQualityControl();

const showQualityPopover = ref(false);
const qualityTagRef = ref<HTMLElement | null>(null);

const handleQualityClick = async () => {
  if (showQualityPopover.value) {
    showQualityPopover.value = false;
  } else {
    await loadQualities();
    if (qualityOptions.value.length > 0) {
      showQualityPopover.value = true;
    }
  }
};

// 点击外部关闭音质选择
const handleClickOutside = (e: MouseEvent) => {
  if (qualityTagRef.value && qualityTagRef.value.contains(e.target as Node)) {
    return;
  }
  showQualityPopover.value = false;
};

// 音量模型：投送态绑定电视音量镜像（tvVolume/tvMuted），否则绑定本地音量（playVolume）
// 两个音量体系彻底分离：电视音量绝不写入用户本地音量设置
const volumeModel = computed<number>({
  get: () => {
    if (dlnaStore.isCasting) {
      return (dlnaStore.tvMuted ? 0 : (dlnaStore.tvVolume ?? 0)) / 100;
    }
    return statusStore.playVolume;
  },
  set: (val: number) => {
    if (dlnaStore.isCasting) {
      void dlnaStore.setVolume(val);
      return;
    }
    player.setVolume(val);
  },
});

// 音量图标：投送态依据电视音量/静音镜像，否则本地音量
const volumeIcon = computed<string>(() => {
  if (dlnaStore.isCasting) {
    const vol = dlnaStore.tvVolume ?? 0;
    if (dlnaStore.tvMuted || vol === 0) return "VolumeOff";
    if (vol < 40) return "VolumeDown";
    return "VolumeUp";
  }
  return statusStore.playVolumeIcon;
});

// 静音按钮：投送态转发电视
const handleVolumeIconClick = () => {
  if (dlnaStore.isCasting) {
    void dlnaStore.toggleMute();
    return;
  }
  player.toggleMute();
};

// 滚轮调音量：基于当前音量模型增减（投送态转发电视，否则控制本地）
const handleVolumeWheel = (e: WheelEvent) => {
  const base = volumeModel.value;
  const next = Math.max(0, Math.min(1, base + (e.deltaY > 0 ? -0.05 : 0.05)));
  volumeModel.value = next;
};

// 更多功能
const audioManager = useAudioManager();

const controlsOptions = computed<DropdownOption[]>(() => [
  {
    label: "均衡器",
    key: "equalizer",
    icon: renderIcon("Eq"),
    disabled: !audioManager.capabilities.supportsEqualizer,
  },
  {
    label: "自动关闭",
    key: "autoClose",
    icon: renderIcon("TimeAuto"),
  },
  {
    label: "AB 循环",
    key: "abLoop",
    icon: renderIcon("Repeat"),
  },
  {
    label: "播放速度",
    key: "rate",
    disabled: !audioManager.capabilities.supportsRate,
    icon: renderIcon("PlayRate"),
  },
]);

// 投送态下打开本地专属功能前提示（功能本身仍作用于本地播放）
const openLocalOnly = (fn: () => void) => {
  if (dlnaStore.isCasting) window.$message.info("投送播放中，该功能仅在本地播放生效");
  fn();
};

// 更多功能选择
const handleControls = (key: string) => {
  switch (key) {
    case "equalizer":
      if (!audioManager.capabilities.supportsEqualizer) {
        window.$message.warning("当前引擎不支持均衡器功能");
        return;
      }
      openLocalOnly(openEqualizer);
      break;
    case "autoClose":
      openAutoClose();
      break;
    case "abLoop":
      openLocalOnly(openABLoop);
      break;
    case "rate":
      openLocalOnly(openChangeRate);
      break;
  }
};

// 更新音质数据
watch(
  () => musicStore.playSong.id,
  async () => {
    statusStore.availableQualities = [];
    await loadQualities();
    if (showQualityPopover.value && statusStore.availableQualities.length === 0) {
      showQualityPopover.value = false;
    }
  },
);

// 监听 VIP 状态或设置变化，重新加载音质
watch([() => dataStore.userData.vipType, () => settingStore.disableAiAudio], async () => {
  statusStore.availableQualities = [];
  await loadQualities();
});
</script>

<style scoped lang="scss">
.right-menu {
  .menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border-radius: 8px;
    transition:
      background-color 0.3s,
      transform 0.3s;
    cursor: pointer;
    .n-icon {
      font-size: 22px;
      color: var(--primary-hex);
    }
    &:hover {
      transform: scale(1.1);
      background-color: rgba(var(--primary), 0.28);
    }
    &:active {
      transform: scale(1);
    }
  }
  :deep(.n-badge-sup) {
    background-color: rgba(var(--primary), 0.28);
    backdrop-filter: blur(20px);
    // font-size: 10px;
    .n-base-slot-machine {
      color: var(--primary-hex);
    }
  }
  .quality-tag {
    height: 26px;
    padding: 0 8px;
    border-radius: 8px;
    cursor: pointer;
  }
  @media (max-width: 810px) {
    .hidden {
      display: none;
    }
  }
}
.quality-title {
  .title {
    font-size: 14px;
    line-height: normal;
  }
  .tip {
    font-size: 12px;
    opacity: 0.6;
  }
}
.volume-change {
  padding: 12px;
  display: flex;
  flex-direction: column;
  height: 180px;
  width: 58px;
  align-items: center;
  .slider-num {
    margin-top: 8px;
    font-size: 13px;
    white-space: nowrap;
  }
}
</style>
