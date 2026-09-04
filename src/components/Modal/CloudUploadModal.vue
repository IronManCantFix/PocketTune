<template>
  <div class="cloud-upload-modal">
    <n-flex :size="20" vertical>
      <n-alert title="请知悉" type="info">
        将把当前歌曲下载后上传至网易云云盘。云盘对上传文件的格式与大小有限制，具体以接口返回为准。
      </n-alert>
      <SongDataCard :data="song" />
      <n-collapse :default-expanded-names="['level']" arrow-placement="right">
        <n-collapse-item title="音质选择" name="level">
          <n-radio-group v-model:value="selectedQuality" name="quality">
            <n-flex>
              <n-radio v-for="(item, index) in qualityOptions" :key="index" :value="item.value">
                <n-flex>
                  <n-text class="name">{{ item.label }}</n-text>
                  <n-text v-if="item.size" depth="3">{{ formatFileSize(item.size) }}</n-text>
                </n-flex>
              </n-radio>
            </n-flex>
          </n-radio-group>
          <n-text depth="3" style="font-size: 12px; margin-top: 10px; display: block">
            注意：如果歌曲没有对应的音质，将自动下载最高可用音质
          </n-text>
        </n-collapse-item>
      </n-collapse>
      <n-flex class="menu" justify="end">
        <n-button strong secondary @click="emit('close')"> 取消 </n-button>
        <n-button type="primary" @click="handleStart"> 开始上传 </n-button>
      </n-flex>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import type { SongType, SongLevelType } from "@/types/main";
import { useSettingStore, useCloudUploadStore } from "@/stores";
import { songLevelData, getSongLevelsData, AI_AUDIO_LEVELS } from "@/utils/meta";
import { formatFileSize } from "@/utils/helper";
import { pick } from "lodash-es";

const props = defineProps<{
  song: SongType;
}>();

const emit = defineEmits<{
  close: [];
}>();

const settingStore = useSettingStore();
const cloudUploadStore = useCloudUploadStore();

const selectedQuality = ref<SongLevelType>(settingStore.downloadSongLevel || "h");

// 音质选项
const qualityOptions = computed(() => {
  const levels = pick(songLevelData, ["l", "m", "h", "sq", "hr", "je", "sk", "db", "jm"]);
  let allData = getSongLevelsData(levels);

  if (settingStore.disableAiAudio) {
    allData = allData.filter((item) => {
      if (item.level === "dolby") return true;
      return !AI_AUDIO_LEVELS.includes(item.level);
    });
  }

  return allData.map((item) => ({
    label: item.name,
    value: item.value,
    size: undefined,
  }));
});

// 开始上传：加入后台队列后立即关闭弹窗
const handleStart = () => {
  const song = props.song;
  if (!song?.id) {
    window.$message.warning("请选择可上传的歌曲");
    return;
  }
  cloudUploadStore.uploadSongToCloud(song, selectedQuality.value);
  window.$message.success("已加入后台上传队列");
  emit("close");
};
</script>

<style scoped lang="scss">
.cloud-upload-modal {
  .menu {
    margin-top: 20px;
  }
}
</style>
