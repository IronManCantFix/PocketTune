<template>
  <n-flex vertical :size="16">
    <!-- 投送入口：扫描设备 -->
    <n-flex align="center" justify="space-between">
      <n-text depth="3">选择局域网内的 DLNA 设备</n-text>
      <n-button size="small" secondary :loading="dlnaStore.discovering" @click="handleRefresh">
        <template #icon><SvgIcon name="Refresh" :size="14" /></template>
        重新扫描
      </n-button>
    </n-flex>

    <!-- 加载提示 -->
    <n-empty v-if="dlnaStore.discovering" description="正在扫描设备…">
      <template #icon><n-spin size="small" /></template>
    </n-empty>

    <!-- 设备列表 -->
    <n-flex v-else vertical :size="8">
      <n-empty
        v-if="dlnaStore.devices.length === 0"
        description="未发现可投送设备，请确认电视已开启 DLNA 并在同一局域网"
      />
      <div
        v-for="device in dlnaStore.devices"
        :key="device.uuid"
        class="device-item"
        :class="{ active: dlnaStore.activeDevice?.uuid === device.uuid }"
        @click="handleCast(device.uuid)"
      >
        <SvgIcon name="RssFeed" :size="20" class="device-icon" />
        <n-flex class="device-meta" vertical :size="2">
          <span class="device-name">{{ device.name }}</span>
          <span class="device-desc">{{ device.deviceType }}</span>
        </n-flex>
        <n-button
          v-if="dlnaStore.activeDevice?.uuid === device.uuid"
          size="small"
          type="primary"
          disabled
        >
          已连接
        </n-button>
      </div>
      <n-text depth="3" style="font-size: 12px">
        提示：局域网内投送，手机与电视需连接同一 Wi-Fi。
      </n-text>
    </n-flex>
  </n-flex>
</template>

<script setup lang="ts">
import { useDlnaStore } from "@/stores";

const dlnaStore = useDlnaStore();

// 打开弹窗时自动扫描一次
onMounted(async () => {
  if (dlnaStore.devices.length === 0 && !dlnaStore.discovering) {
    await dlnaStore.discover();
  }
});

// 手动重新扫描
const handleRefresh = async () => {
  await dlnaStore.discover();
};

// 投送到指定设备
const handleCast = async (uuid: string) => {
  const success = await dlnaStore.castTo(uuid);
  if (success) {
    window.$message.success(
      `已投送到 ${dlnaStore.devices.find((d) => d.uuid === uuid)?.name ?? "设备"}`,
    );
  }
};
</script>

<style scoped lang="scss">
.device-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(var(--primary), 0.2);
  border-radius: 10px;
  cursor: pointer;
  transition:
    background-color 0.3s,
    border-color 0.3s;

  &:hover {
    background-color: rgba(var(--primary), 0.08);
  }

  &.active {
    border-color: var(--primary-hex);
    background-color: rgba(var(--primary), 0.1);
  }

  .device-icon {
    color: var(--primary-hex);
    flex-shrink: 0;
  }

  .device-meta {
    flex: 1;
    min-width: 0;

    .device-name {
      font-size: 14px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .device-desc {
      font-size: 12px;
      opacity: 0.6;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
</style>
