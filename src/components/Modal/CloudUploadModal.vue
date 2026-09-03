<template>
  <div class="cloud-upload-modal">
    <!-- 选择音质阶段 -->
    <n-collapse-transition :show="stage === 'choose'">
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
          <n-button type="primary" :loading="uploading" @click="handleStart"> 开始上传 </n-button>
        </n-flex>
      </n-flex>
    </n-collapse-transition>

    <!-- 下载 + 上传进度阶段 -->
    <n-collapse-transition :show="stage === 'progress'">
      <n-flex :size="20" vertical>
        <SongDataCard :data="song" />
        <div class="progress-item">
          <div class="label">
            <n-text>下载音频</n-text>
            <n-text depth="3" style="font-size: 12px">{{ downText }}</n-text>
          </div>
          <n-progress type="line" :percentage="downProgress" :show-indicator="false" />
        </div>
        <div class="progress-item">
          <div class="label">
            <n-text>上传至云盘</n-text>
            <n-text depth="3" style="font-size: 12px">{{ upText }}</n-text>
          </div>
          <n-progress type="line" :percentage="upProgress" :show-indicator="false" />
        </div>
        <n-flex justify="end">
          <n-button strong secondary @click="emit('close')" :disabled="uploading"> 关闭 </n-button>
        </n-flex>
      </n-flex>
    </n-collapse-transition>
  </div>
</template>

<script setup lang="ts">
import type { SongType, SongLevelType } from "@/types/main";
import { useSettingStore } from "@/stores";
import { songLevelData, getSongLevelsData, AI_AUDIO_LEVELS } from "@/utils/meta";
import { formatFileSize, toProxiedUrl } from "@/utils/helper";
import { getPlayerInfoObj } from "@/utils/format";
import { songDownloadUrl } from "@/api/song";
import { uploadCloudSong } from "@/api/cloud";
import { pick } from "lodash-es";
import axios from "axios";

const props = defineProps<{
  song: SongType;
}>();

const emit = defineEmits<{
  close: [];
}>();

const settingStore = useSettingStore();

// 流程阶段
const stage = ref<"choose" | "progress">("choose");
const uploading = ref(false);
const downProgress = ref(0);
const upProgress = ref(0);
const downText = ref("");
const upText = ref("");

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

// 生成上传文件名
const getFileName = (fileType: string): string => {
  const infoObj = getPlayerInfoObj(props.song) || {
    name: props.song.name || "未知歌曲",
    artist: "未知歌手",
  };
  const baseTitle = infoObj.name || "未知歌曲";
  const rawArtist = infoObj.artist || "未知歌手";
  const safeArtist = rawArtist.replace(/[/:*?"<>|]/g, "&");
  const { fileNameFormat } = settingStore;

  let displayName = baseTitle;
  if (fileNameFormat === "artist-title") displayName = `${safeArtist} - ${baseTitle}`;
  else if (fileNameFormat === "title-artist") displayName = `${baseTitle} - ${safeArtist}`;

  return displayName.replace(/[/:*?"<>|]/g, "&") + "." + fileType;
};

// 开始上传
const handleStart = async () => {
  const song = props.song;
  if (!song?.id) {
    window.$message.warning("请选择可上传的歌曲");
    return;
  }
  stage.value = "progress";
  uploading.value = true;
  downProgress.value = 0;
  upProgress.value = 0;

  try {
    // 1. 获取下载链接
    const result = await songDownloadUrl(song.id, selectedQuality.value);
    if (result.code !== 200 || !result?.data?.url) {
      window.$message.error(result.message || "获取下载链接失败");
      return;
    }
    const downloadUrl = result.data.url;
    const fileType = (result.data.type || "mp3").toLowerCase();

    // 2. 拉取音频二进制（经同源代理避免跨域）
    downText.value = "正在下载音频...";
    const proxyUrl = toProxiedUrl(downloadUrl, true);
    const response = await axios.get(proxyUrl, {
      responseType: "blob",
      onDownloadProgress: (event) => {
        if (event.total) {
          downProgress.value = Math.round((event.loaded * 100) / event.total);
        }
      },
    });
    downText.value = "";
    const blob = response.data;
    if (!blob || blob.size === 0) {
      window.$message.error("音频下载失败，请重试");
      return;
    }

    // 3. 上传到云盘
    upText.value = "正在上传至云盘...";
    const file = new File([blob], getFileName(fileType), { type: blob.type || "audio/mpeg" });
    const uploadResult = await uploadCloudSong(file, (percent) => {
      upProgress.value = percent;
    });

    // 4. 处理上传结果
    if (uploadResult?.code === 200) {
      const failed = uploadResult?.data?.failed?.[0];
      if (failed?.code !== -200) {
        window.$message.success("上传至云盘成功");
      } else {
        window.$message.error(failed?.msg || "上传失败，请重试");
      }
    } else {
      window.$message.error(uploadResult?.msg || "上传失败，请重试");
    }
  } catch (error: any) {
    console.error("上传至云盘失败:", error);
    window.$message.error(error?.message || "上传失败，请重试");
  } finally {
    upText.value = "";
    uploading.value = false;
  }
};
</script>

<style scoped lang="scss">
.cloud-upload-modal {
  .menu {
    margin-top: 20px;
  }
  .progress-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    .label {
      display: flex;
      justify-content: space-between;
    }
  }
}
</style>
