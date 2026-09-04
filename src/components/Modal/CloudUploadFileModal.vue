<template>
  <div class="cloud-upload-file-modal">
    <n-alert title="请知悉" type="info">
      请选择本地音频文件上传至网易云云盘。云盘对上传文件的格式与大小有限制，具体以接口返回为准。
    </n-alert>
    <n-flex :size="20" vertical>
      <n-upload
        accept=".mp3,.flac,.m4a,.aac,.ogg,.wma,.ape,.wav,.opus,.aiff"
        :default-file-list="[]"
        multiple
        :show-file-list="true"
        :custom-request="() => {}"
        @update:file-list="handleFileChange"
      >
        <n-button type="primary" dashed>
          <template #icon>
            <SvgIcon name="FolderMusic" />
          </template>
          选择音频文件
        </n-button>
      </n-upload>
      <n-text v-if="selectedFiles.length" depth="3" class="file-info">
        已选择 {{ selectedFiles.length }} 个文件
      </n-text>

      <n-flex class="menu" justify="end">
        <n-button strong secondary @click="emit('close')"> 关闭 </n-button>
        <n-button type="primary" :disabled="!selectedFiles.length" @click="handleUpload">
          上传
        </n-button>
      </n-flex>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { useCloudUploadStore } from "@/stores";

const emit = defineEmits<{
  close: [];
  // 上传成功后的回调
  success: [];
}>();

const cloudUploadStore = useCloudUploadStore();

// 已选文件列表
const selectedFiles = ref<File[]>([]);

// 选择文件
const handleFileChange = (fileList: any[]) => {
  const files: File[] = [];
  for (const fileObj of fileList) {
    const file = fileObj?.file;
    if (!file?.name) continue;
    // 校验音频格式
    const acceptList = ["mp3", "flac", "m4a", "aac", "ogg", "wma", "ape", "wav", "opus", "aiff"];
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!acceptList.includes(ext)) {
      window.$message.warning(`文件 ${file.name} 不是支持的音频格式，已忽略`);
      continue;
    }
    files.push(file);
  }
  selectedFiles.value = files;
};

// 上传文件：加入后台队列后立即关闭弹窗
const handleUpload = () => {
  if (!selectedFiles.value.length) {
    window.$message.warning("请先选择音频文件");
    return;
  }
  cloudUploadStore.uploadFilesToCloud(selectedFiles.value);
  window.$message.success(`已加入后台上传队列（${selectedFiles.value.length} 个文件）`);
  emit("success");
  emit("close");
};
</script>

<style scoped lang="scss">
.cloud-upload-file-modal {
  .file-info {
    word-break: break-all;
  }
  .menu {
    margin-top: 20px;
  }
}
</style>
