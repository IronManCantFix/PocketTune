<template>
  <n-scrollbar style="max-height: 70vh" class="font-manager">
    <div class="set-list">
      <n-h3 prefix="bar">通用字体</n-h3>
      <n-card class="set-item input-mode">
        <div class="label">
          <div style="display: flex; justify-content: space-between; align-items: center">
            <div class="info" style="display: flex; flex-direction: column">
              <n-text class="name">全局字体</n-text>
              <n-text class="tip" :depth="3">应用到软件内所有非特定区域的字体</n-text>
            </div>
            <Transition name="fade" mode="out-in">
              <n-button
                :disabled="settingStore.globalFont === 'default'"
                type="primary"
                strong
                secondary
                @click="settingStore.globalFont = 'default'"
              >
                恢复默认
              </n-button>
            </Transition>
          </div>
        </div>
        <n-flex align="center">
          <s-input
            v-model:value="settingStore.globalFont"
            :update-value-on-input="false"
            placeholder="输入字体名称"
            class="set"
          />
        </n-flex>
      </n-card>
    </div>
    <div class="set-list">
      <n-h3 prefix="bar">歌词字体</n-h3>
      <n-card v-for="font in lyricFontConfigs" :key="font.keySetting" class="set-item input-mode">
        <div class="label">
          <div class="label-header">
            <div class="info" style="display: flex; flex-direction: column">
              <n-text class="name">{{ font.name }}</n-text>
              <n-text class="tip" :depth="3">{{ font.tip }}</n-text>
            </div>
            <Transition name="fade" mode="out-in">
              <n-button
                :disabled="settingStore[font.keySetting] === font.default"
                type="primary"
                strong
                secondary
                @click="settingStore[font.keySetting] = font.default"
              >
                恢复默认
              </n-button>
            </Transition>
          </div>
        </div>
        <n-flex align="center">
          <s-input
            v-model:value="settingStore[font.keySetting]"
            :update-value-on-input="false"
            placeholder="输入字体名称"
            class="set"
          />
        </n-flex>
      </n-card>
    </div>
  </n-scrollbar>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { lyricFontConfigs } from "@/utils/lyric/lyricFontConfig";

const settingStore = useSettingStore();
</script>

<style lang="scss" scoped>
.font-manager {
  .set-list {
    margin-bottom: 24px;
    &:last-child {
      margin-bottom: 0;
    }
  }

  .set-item {
    width: 100%;
    border-radius: 8px;
    margin-bottom: 12px;
    transition: margin 0.3s;
    &:last-child {
      margin-bottom: 0;
    }
    :deep(.n-card__content) {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
    }
    .label {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      padding-right: 20px;
      .label-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        min-width: 0;
      }
      .name {
        font-size: 16px;
        min-width: 0;
      }
    }
    .n-flex {
      flex-flow: nowrap !important;
    }
    .set {
      justify-content: flex-end;
      width: 200px;
      flex-shrink: 0;
      &.n-switch {
        width: max-content;
      }
      @media (max-width: 768px) {
        width: 140px;
        min-width: 140px;
      }
      @media (max-width: 480px) {
        width: 120px;
        min-width: 120px;
      }
    }
    &.input-mode {
      :deep(.n-card__content) {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
      }
      .label {
        padding-right: 0;
      }
      .n-flex {
        width: 100%;
        flex-flow: wrap !important;
        justify-content: flex-end !important;
      }
      .set {
        width: 100%;
        max-width: none;
        order: -1;
      }
      .n-button {
        margin-left: auto;
      }
    }
  }
}
</style>
