<template>
  <div class="song-unlock-manager">
    <n-alert title="免责声明" type="info">
      本功能仅作为测试使用，资源来自网络，若侵犯到您的权益，请及时联系我们删除
    </n-alert>
    <n-alert type="warning" :bordered="false" class="exclusive-tip">
      默认解锁源与洛雪自定义源互斥：开启其中一边会自动关闭另一边（含服务端解灰）
    </n-alert>
    <div ref="sortableRef" class="sortable-list">
      <n-card
        v-for="item in settingStore.songUnlockServer"
        :key="item.key"
        :content-style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '16px',
        }"
        class="sortable-item"
      >
        <SvgIcon :depth="3" name="Menu" />
        <n-text class="name">{{ labelOf(item.key) }}</n-text>
        <n-switch v-model:value="item.enabled" :round="false" @update:value="handleToggle(item)" />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { SongUnlockServer } from "@/core/player/SongManager";
import { setUnblockMode } from "@/api/song";
import { useSortable } from "@vueuse/integrations/useSortable";
import type { Options } from "sortablejs";

const settingStore = useSettingStore();

// 音源显示名映射
const SOURCE_LABELS: Record<string, string> = {
  netease: "GD音乐台",
  bodian: "波点音乐",
  kuwo: "酷我音乐",
  lx: "洛雪自定义源",
};

const labelOf = (key: string): string => SOURCE_LABELS[key] ?? key;

const sortableRef = ref<HTMLElement | null>(null);

/**
 * 互斥联动：开启洛雪源则关闭其余默认源，开启任一默认源则关闭洛雪源
 * 同时同步服务端模式，停用/恢复 UNM 解灰
 * @param changed 本次被切换的条目
 */
const handleToggle = async (changed: { key: string; enabled: boolean }) => {
  const isLx = changed.key === SongUnlockServer.LX;
  if (!changed.enabled) {
    // 关闭操作不触发联动：全部关闭时视为回到默认渠道
    const anyEnabled = settingStore.songUnlockServer.some((s) => s.enabled);
    if (!anyEnabled) await syncMode("default");
    return;
  }

  // 开启一边即关闭另一边
  settingStore.songUnlockServer.forEach((item) => {
    if (item.key === changed.key) return;
    if (isLx ? item.key !== SongUnlockServer.LX : item.key === SongUnlockServer.LX) {
      item.enabled = false;
    }
  });
  await syncMode(isLx ? "lx" : "default");
};

/** 同步服务端解灰模式，失败时提示但不回滚本地开关 */
const syncMode = async (mode: "default" | "lx") => {
  try {
    await setUnblockMode(mode);
  } catch (error) {
    console.error("解灰模式同步失败:", error);
    window.$message.error("解灰模式同步失败，请检查服务端连接");
  }
};

// 拖拽
useSortable(sortableRef, settingStore.songUnlockServer, {
  animation: 150,
  handle: ".n-icon",
} as Options);
</script>

<style scoped lang="scss">
.song-unlock-manager {
  .exclusive-tip {
    margin-top: 12px;
  }
}
.sortable-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  .sortable-item {
    border-radius: 8px;
    .n-icon {
      font-size: 16px;
      cursor: move;
    }
    .name {
      font-size: 16px;
      line-height: normal;
    }
    .n-switch {
      margin-left: auto;
    }
  }
}
</style>
