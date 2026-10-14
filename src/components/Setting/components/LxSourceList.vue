<template>
  <div class="lx-sources">
    <n-alert type="warning" :bordered="false" class="notice">
      自定义源脚本来自第三方，内容不可控。启用前请确认来源可信，脚本将以服务器权限发起网络请求。
    </n-alert>

    <n-flex class="actions" :size="8">
      <n-button strong secondary @click="handleImport">
        <template #icon>
          <SvgIcon name="Add" />
        </template>
        导入脚本
      </n-button>
      <n-button strong secondary :loading="loading" @click="loadSources">
        <template #icon>
          <SvgIcon name="Refresh" />
        </template>
        刷新
      </n-button>
      <n-text :depth="3" class="summary"
        >共 {{ sources.length }} 个，启用 {{ enabledCount }} 个</n-text
      >
    </n-flex>

    <n-spin :show="loading">
      <n-empty v-if="sources.length === 0" description="尚未导入任何洛雪源脚本" class="empty" />
      <div v-else ref="sortableRef" class="sortable-list">
        <n-card
          v-for="item in sources"
          :key="item.id"
          :content-style="{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
          }"
          class="sortable-item"
        >
          <span class="drag-handle">
            <SvgIcon :depth="3" name="Menu" />
          </span>
          <div class="info">
            <n-flex align="center" :size="8">
              <n-text class="name">{{ item.meta.name || item.id }}</n-text>
              <n-tag v-if="item.meta.version" size="tiny" :bordered="false">
                {{ item.meta.version }}
              </n-tag>
              <n-tag size="tiny" :bordered="false" type="info">
                {{ item.platforms.join(" / ") || "未识别" }}
              </n-tag>
              <n-tag v-if="item.runtimeError" size="tiny" :bordered="false" type="error">
                加载失败
              </n-tag>
            </n-flex>
            <n-text :depth="3" class="tip">
              {{ item.runtimeError || item.meta.description || item.meta.author || "无描述" }}
            </n-text>
          </div>
          <n-switch
            :value="item.enabled"
            :round="false"
            :disabled="!!item.runtimeError"
            @update:value="(v: boolean) => handleToggle(item, v)"
          />
          <n-popconfirm @positive-click="handleDelete(item)">
            <template #trigger>
              <n-button strong secondary type="error" size="small">
                <template #icon>
                  <SvgIcon name="Delete" />
                </template>
              </n-button>
            </template>
            确定要删除脚本「{{ item.meta.name || item.id }}」吗？
          </n-popconfirm>
        </n-card>
      </div>
    </n-spin>

    <n-text :depth="3" class="tip"
      >拖动调整优先级，解析时按顺序尝试，单个脚本失败会自动跳过；切换仅对之后解析的歌曲生效</n-text
    >
  </div>
</template>

<script setup lang="ts">
import { useSortable } from "@vueuse/integrations/useSortable";
import type { Options } from "sortablejs";
import { deleteLxSource, getLxSources, reorderLxSources, toggleLxSource } from "@/api/song";
import LxSourceImport from "@/components/Modal/Setting/LxSourceImport.vue";

/** 服务端返回的脚本记录 */
type LxSourceItem = {
  id: string;
  meta: { name: string; description: string; version: string; author: string; homepage: string };
  size: number;
  enabled: boolean;
  platforms: string[];
  createdAt: string;
  loaded: boolean;
  runtimeError?: string;
};

const sources = ref<LxSourceItem[]>([]);
const loading = ref(false);
const sortableRef = ref<HTMLElement | null>(null);

const enabledCount = computed(() => sources.value.filter((item) => item.enabled).length);

// 读取脚本列表
const loadSources = async () => {
  loading.value = true;
  try {
    const res = await getLxSources();
    sources.value = res?.sources ?? [];
  } catch (error) {
    console.error("洛雪源列表读取失败:", error);
    window.$message.error("洛雪源列表读取失败，请检查服务端连接");
  } finally {
    loading.value = false;
  }
};

// 拖拽结束后按新顺序写回服务端
useSortable(sortableRef, sources, {
  animation: 150,
  handle: ".drag-handle",
  onEnd: async () => {
    try {
      await reorderLxSources(sources.value.map((item) => item.id));
      window.$message.success("优先级已更新");
    } catch (error) {
      console.error("洛雪源排序失败:", error);
      window.$message.error("优先级保存失败");
      await loadSources();
    }
  },
} as Options);

// 导入脚本：打开专用弹窗
const handleImport = () => {
  const modal = window.$dialog.create({
    title: "导入洛雪源脚本",
    style: { width: "560px" },
    content: () =>
      h(LxSourceImport, {
        onSuccess: () => {
          modal.destroy();
          void loadSources();
        },
        onCancel: () => modal.destroy(),
      }),
    // 由子组件自行控制关闭，隐藏默认操作区
    action: () => null,
  });
};

// 启用/禁用脚本
const handleToggle = async (item: LxSourceItem, enabled: boolean) => {
  try {
    await toggleLxSource(item.id, enabled);
    item.enabled = enabled;
    if (enabled) window.$message.success(`已启用「${item.meta.name || item.id}」`);
  } catch (error) {
    console.error("洛雪源切换失败:", error);
    window.$message.error("切换失败，请检查服务端连接");
    await loadSources();
  }
};

// 删除脚本
const handleDelete = async (item: LxSourceItem) => {
  try {
    await deleteLxSource(item.id);
    window.$message.success("脚本已删除");
    await loadSources();
  } catch (error) {
    console.error("洛雪源删除失败:", error);
    window.$message.error("删除失败");
  }
};

onMounted(loadSources);
</script>

<style scoped lang="scss">
.lx-sources {
  width: 100%;
  .notice {
    margin-bottom: 12px;
  }
  .actions {
    margin-bottom: 12px;
    .summary {
      font-size: 12px;
      margin-left: auto;
    }
  }
  .empty {
    padding: 24px 0;
  }
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
      .info {
        flex: 1;
        min-width: 0;
        .name {
          font-size: 14px;
          line-height: normal;
        }
        .tip {
          display: block;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    }
  }
  .tip {
    display: block;
    margin-top: 8px;
    font-size: 12px;
  }
}
</style>
