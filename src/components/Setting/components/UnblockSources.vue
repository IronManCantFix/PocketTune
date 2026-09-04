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
const defaults = ref<string[]>([]);

// 服务端音源状态响应
type ServerSourcesResult = {
  sources?: string[];
  custom?: boolean;
  defaults?: string[];
};

const labelOf = (key: string) => KNOWN_SOURCES.find((s) => s.key === key)?.label ?? key;

const sortableRef = ref<HTMLElement | null>(null);

// 拖拽调整优先级
useSortable(sortableRef, list, {
  animation: 150,
  handle: ".drag-handle",
} as Options);

// 用服务端响应同步「当前生效」与开关状态，保证两者一致
const applyServerState = (res: ServerSourcesResult | undefined | null) => {
  effective.value = res?.sources ?? [];
  custom.value = !!res?.custom;
  if (res?.defaults?.length) defaults.value = res.defaults;
  // 以服务端生效列表为准回填开关，避免本地残留配置与服务端不一致
  if (effective.value.length > 0) list.value = initList(effective.value);
};

// 同步到服务端（防抖）
const syncToServer = useDebounceFn(async () => {
  try {
    const res = await setUnblockSources(settingStore.unblockSources);
    // 本地已清空自定义（如关闭全部音源）时，按服务端默认生效列表回填开关
    if (settingStore.unblockSources.length === 0 && res?.sources?.length) {
      applyServerState(res);
    } else {
      effective.value = res?.sources ?? [];
      custom.value = !!res?.custom;
    }
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

// 恢复默认顺序：清除自定义并按服务端默认回填开关
const resetSources = async () => {
  settingStore.unblockSources = [];
  const fallback = defaults.value.length > 0 ? defaults.value : KNOWN_SOURCES.map((s) => s.key);
  list.value = initList(fallback);
  try {
    applyServerState(await setUnblockSources([]));
  } catch (error) {
    console.error("解灰音源恢复默认失败:", error);
    window.$message.error("恢复默认失败，请检查服务端连接");
    // 失败时按当前生效回填，保持开关与生效一致
    if (effective.value.length > 0) list.value = initList(effective.value);
  }
};

// 初始化：以服务端当前状态为准回填开关，保证与「当前生效」一致
onMounted(async () => {
  try {
    applyServerState(await getUnblockSources());
  } catch (error) {
    console.error("解灰音源读取失败:", error);
  }
  // 本地存在自定义配置时同步到服务端，并用响应校准 UI
  if (settingStore.unblockSources.length > 0) {
    try {
      applyServerState(await setUnblockSources(settingStore.unblockSources));
    } catch (error) {
      console.error("解灰音源同步失败:", error);
    }
  }
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
