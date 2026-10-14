<template>
  <div class="lx-source-import">
    <n-alert type="warning" :bordered="false" class="notice">
      脚本将以服务器权限运行并发起网络请求，请仅导入可信来源的脚本。
    </n-alert>
    <n-tabs v-model:value="mode" type="segment" animated>
      <n-tab-pane name="url" tab="远程地址">
        <n-form label-placement="top">
          <n-form-item label="脚本地址">
            <n-input
              v-model:value="remoteUrl"
              placeholder="https://example.com/source.js"
              clearable
            />
          </n-form-item>
        </n-form>
        <n-text :depth="3" class="hint">
          服务器会拉取该地址的脚本内容，请确认地址可公网访问且指向 .js 脚本
        </n-text>
      </n-tab-pane>
      <n-tab-pane name="script" tab="粘贴内容">
        <n-input
          v-model:value="scriptContent"
          type="textarea"
          :rows="10"
          placeholder="在此粘贴洛雪源脚本内容…"
          class="code-input"
        />
      </n-tab-pane>
    </n-tabs>
    <n-flex justify="end" style="margin-top: 16px">
      <n-button @click="handleCancel">取消</n-button>
      <n-button type="primary" :loading="loading" @click="handleImport">导入</n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { importLxSource } from "@/api/song";

const emit = defineEmits<{
  /** 导入成功 */
  success: [];
  /** 取消 */
  cancel: [];
}>();

/** 导入方式：远程地址或粘贴内容 */
const mode = ref<"url" | "script">("url");
const remoteUrl = ref<string>("");
const scriptContent = ref<string>("");
const loading = ref<boolean>(false);

const handleCancel = () => emit("cancel");

const handleImport = async () => {
  const url = remoteUrl.value.trim();
  const script = scriptContent.value.trim();
  if (mode.value === "url" && !url) {
    window.$message.warning("请填写脚本地址");
    return;
  }
  if (mode.value === "script" && !script) {
    window.$message.warning("请粘贴脚本内容");
    return;
  }
  loading.value = true;
  try {
    await importLxSource(mode.value === "url" ? { url } : { script });
    window.$message.success("脚本导入成功，请手动启用");
    emit("success");
  } catch (error) {
    const message =
      (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
      "脚本导入失败";
    window.$message.error(message);
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped lang="scss">
.lx-source-import {
  .notice {
    margin-bottom: 12px;
  }
  .hint {
    display: block;
    font-size: 12px;
  }
  .code-input {
    :deep(textarea) {
      font-family: monospace;
      font-size: 12px;
    }
  }
}
</style>
