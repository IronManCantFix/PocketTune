<template>
  <div class="unblock-sources">
    <div ref="sortableRef" class="sortable-list">
      <n-card
        v-for="item in list"
        :key="item.key"
        :content-style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 16px',
        }"
        class="sortable-item"
      >
        <span class="drag-handle">
          <SvgIcon :depth="3" name="Menu" />
        </span>
        <n-text class="name">{{ item.label }}</n-text>
        <n-text :depth="3" class="key">{{ item.key }}</n-text>
        <n-switch v-model:value="item.enabled" :round="false" @update:value="handleToggle" />
      </n-card>
    </div>
    <n-flex align="center" :size="8" class="effective">
      <n-text :depth="3">当前生效：</n-text>
      <n-tag v-for="key in effective" :key="key" size="small" :bordered="false" type="primary">
        {{ labelOf(key) }}
      </n-tag>
      <n-tag v-if="custom" size="small" type="warning">自定义</n-tag>
      <n-tag v-else size="small">默认顺序</n-tag>
      <n-button quaternary size="tiny" @click="resetSources"> 恢复默认 </n-button>
    </n-flex>
    <n-text :depth="3" class="tip"
      >拖动调整优先级；关闭全部音源将恢复默认顺序，切换仅对之后解析的歌曲生效</n-text
    >
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import { useSortable } from "@vueuse/integrations/useSortable";
import type { Options } from "sortablejs";
import { getUnblockSources, setUnblockSources } from "@/api/song";
import { useSettingStore } from "@/stores";

// 可用音源及显示名
const KNOWN_SOURCES: { key: string; label: string }[] = [
  { key: "kugou", label: "酷狗音乐" },
  { key: "kuwo", label: "酷我音乐" },
  { key: "migu", label: "咪咕音乐" },
  { key: "bilibili", label: "哔哩哔哩" },
  { key: "pyncmd", label: "网易云直连" },
];

const settingStore = useSettingStore();

type SourceItem = { key: string; label: string; enabled: boolean };

// 按已启用顺序 + 未启用音源排列
const initList = (enabledKeys?: string[]): SourceItem[] => {
  const sourceKeys = enabledKeys ?? settingStore.unblockSources;
  const enabled = sourceKeys
    .map((key) => KNOWN_SOURCES.find((s) => s.key === key))
    .filter((s): s is { key: string; label: string } => !!s)
    .map((s) => ({ ...s, enabled: true }));
  const rest = KNOWN_SOURCES.filter((s) => !enabled.some((e) => e.key === s.key)).map((s) => ({
    ...s,
    enabled: false,
  }));
  return [...enabled, ...rest];
};

const list = ref<SourceItem[]>(initList());
const effective = ref<string[]>([]);
const custom = ref(false);

const labelOf = (key: string) => KNOWN_SOURCES.find((s) => s.key === key)?.label ?? key;

const sortableRef = ref<HTMLElement | null>(null);

// 拖拽调整优先级
useSortable(sortableRef, list, {
  animation: 150,
  handle: ".drag-handle",
} as Options);

// 同步到服务端（防抖）
const syncToServer = useDebounceFn(async () => {
  try {
    const res = await setUnblockSources(settingStore.unblockSources);
    effective.value = res?.sources ?? [];
    custom.value = !!res?.custom;
  } catch (error) {
    console.error("解灰音源同步失败:", error);
    window.$message.error("音源同步失败，请检查服务端连接");
  }
}, 500);

// 写回 store 并触发同步
const syncSetting = () => {
  settingStore.unblockSources = list.value.filter((item) => item.enabled).map((item) => item.key);
  syncToServer();
};

const handleToggle = () => syncSetting();

// 恢复默认顺序
const resetSources = () => {
  list.value = initList().map((item) => ({ ...item, enabled: false }));
  syncSetting();
};

// 初始化：读取服务端当前状态，并在存在自定义配置时回填同步
onMounted(async () => {
  try {
    const res = await getUnblockSources();
    effective.value = res?.sources ?? [];
    custom.value = !!res?.custom;
    // 未自定义时按服务端生效顺序回填开关状态，与默认顺序保持一致
    if (settingStore.unblockSources.length === 0 && res?.sources?.length && !res?.custom) {
      list.value = initList(res.sources);
    }
  } catch (error) {
    console.error("解灰音源读取失败:", error);
  }
  if (settingStore.unblockSources.length > 0) syncToServer();
});
</script>

<style scoped lang="scss">
.unblock-sources {
  width: 100%;
  .sortable-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    .sortable-item {
      border-radius: 8px;
      .drag-handle {
        display: flex;
        cursor: move;
        .n-icon {
          font-size: 16px;
        }
      }
      .name {
        font-size: 14px;
        line-height: normal;
      }
      .key {
        font-size: 12px;
      }
      .n-switch {
        margin-left: auto;
      }
    }
  }
  .effective {
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .tip {
    display: block;
    margin-top: 6px;
    font-size: 12px;
  }
}
</style>
