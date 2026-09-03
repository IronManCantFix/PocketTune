<template>
  <div class="batch-list">
    <n-data-table
      v-model:checked-row-keys="checkedRowKeys"
      :columns="columnsData"
      :data="tableData"
      :row-key="(row) => row.key"
      max-height="60vh"
      virtual-scroll
      @update:checked-row-keys="tableCheck"
    />
    <n-flex class="batch-footer" justify="space-between" align="center">
      <n-flex align="center">
        <n-text :depth="3" class="count">已选择 {{ checkCount }} 首</n-text>
        <n-popover trigger="click" placement="right">
          <template #trigger>
            <n-button tertiary> 高级筛选 </n-button>
          </template>
          <n-flex :wrap="false" align="center">
            <n-input-number
              v-model:value="startRange"
              class="range-input"
              placeholder="开始"
              :min="1"
              :max="props.data.length"
              size="small"
            />
            <n-text>-</n-text>
            <n-input-number
              v-model:value="endRange"
              class="range-input"
              placeholder="结束"
              :min="1"
              :max="props.data.length"
              size="small"
            />
            <n-button size="small" secondary @click="handleRangeSelect"> 选择 </n-button>
          </n-flex>
        </n-popover>
      </n-flex>
      <n-flex class="menu">
        <!-- 批量下载 -->
        <n-button
          v-if="statusStore.isDeveloperMode"
          :disabled="!checkCount || isLocal"
          type="primary"
          strong
          secondary
          @click="handleBatchDownloadClick"
        >
          <template #icon>
            <SvgIcon name="Download" />
          </template>
          批量下载
        </n-button>
        <!-- 批量删除（歌单场景） -->
        <n-button
          v-if="playListId"
          :disabled="!checkCount"
          type="error"
          strong
          secondary
          @click="
            deleteSongs(
              playListId,
              checkSongData.map((item) => item.id),
              {
                songName: checkSongData.length === 1 ? checkSongData[0].name : undefined,
              },
            )
          "
        >
          <template #icon>
            <SvgIcon name="Delete" />
          </template>
          删除选中的歌曲
        </n-button>
        <!-- 批量删除（云盘场景） -->
        <n-button
          v-if="isCloud && !playListId"
          :disabled="!checkCount"
          :loading="deleting"
          type="error"
          strong
          secondary
          @click="handleBatchDeleteCloud"
        >
          <template #icon>
            <SvgIcon name="Delete" />
          </template>
          删除选中的歌曲
        </n-button>
        <!-- 添加到歌单 -->
        <n-button
          :disabled="!checkCount"
          type="primary"
          strong
          secondary
          @click="openPlaylistAdd(checkSongData, props.isLocal)"
        >
          <template #icon>
            <SvgIcon name="AddList" />
          </template>
          添加到歌单
        </n-button>
      </n-flex>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import type { SongType } from "@/types/main";
import { isArray, isObject } from "lodash-es";
import { openPlaylistAdd } from "@/utils/modal";
import { deleteSongs } from "@/utils/auth";
import { NInputNumber, NButton, NText, NFlex } from "naive-ui";
import { useStatusStore } from "@/stores";
import { openDownloadSongs } from "@/utils/modal";
import { deleteCloudSong } from "@/api/cloud";
import { useDataStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";

const statusStore = useStatusStore();
const dataStore = useDataStore();
const player = usePlayerController();

interface DataType {
  key?: number;
  id?: number;
  name?: string;
  artists?: string;
  album?: string;
  // 原始数据
  origin?: SongType;
}

const props = defineProps<{
  data: SongType[];
  isLocal: boolean;
  playListId?: number;
  // 是否为云盘场景
  isCloud?: boolean;
  // 批量删除成功后的回调
  onSuccess?: () => void;
}>();

// 选中数据
const checkCount = ref<number>(0);
const checkSongData = ref<SongType[]>([]);
const checkedRowKeys = ref<DataTableRowKey[]>([]);

// 范围选择
const startRange = ref<number | null>(null);
const endRange = ref<number | null>(null);

// 表头数据
const columnsData = computed<DataTableColumns<DataType>>(() => [
  {
    type: "selection",
    disabled(row: DataType) {
      return !row.id;
    },
  },
  {
    title: "#",
    key: "key",
    width: 80,
  },
  {
    title: "标题",
    key: "name",
    ellipsis: {
      tooltip: true,
    },
  },
  {
    title: "歌手",
    key: "artists",
    ellipsis: {
      tooltip: true,
    },
  },
  {
    title: "专辑",
    key: "album",
    ellipsis: {
      tooltip: true,
    },
  },
]);

// 表格数据
const tableData = computed<DataType[]>(() =>
  props.data.map((song, index) => ({
    key: index + 1,
    id: song?.id,
    name: song?.name || "未知曲目",
    artists: isArray(song?.artists)
      ? // 拼接歌手
        song?.artists.map((ar: { name: string }) => ar.name).join(" / ")
      : song?.artists || "未知歌手",
    album: isObject(song?.album) ? song?.album.name : song?.album || "未知专辑",
    // 原始数据
    origin: song,
  })),
);

// 表格勾选
const tableCheck = (keys: DataTableRowKey[]) => {
  checkedRowKeys.value = keys;
  // 更改选中数量
  checkCount.value = keys.length;
  // 更改选中歌曲
  const selectedRows = tableData.value.filter((row) => row.key && keys.includes(row.key));
  checkSongData.value = selectedRows.map((row) => row.origin).filter((song) => song) as SongType[];
};

// 范围选择处理
const handleRangeSelect = () => {
  if (startRange.value === null || endRange.value === null) {
    window.$message.warning("请输入起始和结束序号");
    return;
  }

  const start = Math.max(1, Math.min(startRange.value, props.data.length));
  const end = Math.max(1, Math.min(endRange.value, props.data.length));

  if (start > end) {
    window.$message.warning("起始序号不能大于结束序号");
    return;
  }

  const selectedRows = tableData.value.slice(start - 1, end).filter((row) => row.id);

  checkedRowKeys.value = selectedRows.map((row) => row.key as DataTableRowKey);
  checkCount.value = selectedRows.length;
  checkSongData.value = selectedRows.map((row) => row.origin).filter((song) => song) as SongType[];
};

// 批量下载处理
const handleBatchDownloadClick = () => {
  if (checkSongData.value.length === 0) {
    window.$message.warning("请选择要下载的歌曲");
    return;
  }
  openDownloadSongs(checkSongData.value);
};

// 云盘批量删除状态
const deleting = ref<boolean>(false);

// 云盘批量删除处理
const handleBatchDeleteCloud = () => {
  if (checkCount.value === 0) {
    window.$message.warning("请选择要删除的歌曲");
    return;
  }
  const ids = checkSongData.value.map((item) => item.id);
  window.$dialog.warning({
    title: "删除云盘歌曲",
    content: `确定从云盘中删除选中的 ${ids.length} 首歌曲吗？该操作无法撤销！`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      deleting.value = true;
      try {
        let successCount = 0;
        for (const id of ids) {
          const result = await deleteCloudSong(id);
          if (result.code === 200) successCount++;
        }
        // 同步清理当前播放列表中已删除的云盘歌曲
        // 从后往前删除，避免索引错位
        const removedSet = new Set(ids);
        const playList = dataStore.playList;
        for (let i = playList.length - 1; i >= 0; i--) {
          if (playList[i].id && removedSet.has(playList[i].id)) {
            player.removeSongIndex(i);
          }
        }
        window.$message.success(`成功删除 ${successCount} 首云盘歌曲`);
        // 触发回调重新拉取云盘列表
        if (props.onSuccess) props.onSuccess();
      } catch (error) {
        console.error("批量删除云盘歌曲失败:", error);
        window.$message.error("删除失败，请重试");
      } finally {
        deleting.value = false;
      }
    },
  });
};
</script>

<style lang="scss" scoped>
.batch-footer {
  margin-top: 20px;
}
.range-input {
  width: 100px;
}
</style>
