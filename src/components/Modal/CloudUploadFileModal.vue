<template>
  <div class="cloud-upload-file-modal">
    <n-alert v-if="!uploading" title="请知悉" type="info">
      请选择本地音频文件上传至网易云云盘。云盘对上传文件的格式与大小有限制，具体以接口返回为准。
    </n-alert>
    <n-flex :size="20" vertical>
      <!-- 选择文件阶段 -->
      <n-upload
        v-if="!uploading"
        accept=".mp3,.flac,.m4a,.aac,.ogg,.wma,.ape,.wav,.opus,.aiff"
        :default-file-list="[]"
        :max="1"
        :show-file-list="false"
        :custom-request="() => {}"
        @update:file-list="handleFileChange"
      >
        <n-button type="primary" dashed :disabled="uploading">
          <template #icon>
            <SvgIcon name="FolderMusic" />
          </template>
          选择音频文件
        </n-button>
      </n-upload>
      <n-text v-if="selectedFile" depth="3" class="file-info">
        {{ selectedFile.name }}（{{ formatFileSize(selectedFile.size) }}）
      </n-text>

      <!-- 上传进度阶段 -->
      <template v-if="uploading">
        <div class="progress-item">
          <div class="label">
            <n-text>上传至云盘</n-text>
            <n-text depth="3" style="font-size: 12px">{{ upText }}</n-text>
          </div>
          <n-progress type="line" :percentage="upProgress" :show-indicator="false" />
        </div>
        <n-text depth="3" style="font-size: 12px">
          {{ selectedFile?.name }}（{{ formatFileSize(selectedFile?.size || 0) }}）
        </n-text>
      </template>

      <n-flex class="menu" justify="end">
        <n-button strong secondary @click="emit('close')"> 关闭 </n-button>
        <n-button
          type="primary"
          :disabled="!selectedFile"
          :loading="uploading"
          @click="handleUpload"
        >
          上传
        </n-button>
      </n-flex>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { formatFileSize } from "@/utils/helper";
import { uploadCloudSong } from "@/api/cloud";

const emit = defineEmits<{
  close: [];
  // 上传成功后的回调
  success: [];
}>();

const uploading = ref<boolean>(false);
const upProgress = ref(0);
const upText = ref("");
const selectedFile = ref<File | null>(null);

// 选择文件
const handleFileChange = (fileList: any[]) => {
  const fileObj = fileList[0];
  if (!fileObj) {
    selectedFile.value = null;
    return;
  }
  // 校验音频格式
  const acceptList = ["mp3", "flac", "m4a", "aac", "ogg", "wma", "ape", "wav", "opus", "aiff"];
  const fileName = fileObj.file.name || "";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (!acceptList.includes(ext)) {
    window.$message.warning("仅支持上传常见音频格式文件");
    selectedFile.value = null;
    return;
  }
  selectedFile.value = fileObj.file;
};

// 上传文件
const handleUpload = async () => {
  const file = selectedFile.value;
  if (!file) {
    window.$message.warning("请先选择音频文件");
    return;
  }
  uploading.value = true;
  upProgress.value = 0;
  upText.value = "正在上传至云盘...";
  try {
    const uploadResult = await uploadCloudSong(file, (percent) => {
      upProgress.value = percent;
    });
    if (uploadResult?.code === 200) {
      const failed = uploadResult?.data?.failed?.[0];
      if (failed?.code !== -200) {
        window.$message.success("上传至云盘成功");
        emit("success");
        emit("close");
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
.cloud-upload-file-modal {
  .menu {
    margin-top: 20px;
  }
  .file-info {
    word-break: break-all;
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
