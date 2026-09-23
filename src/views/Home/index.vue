<template>
  <div class="home">
    <div v-if="settingStore.showHomeGreeting" class="welcome">
      <div class="welcome-text">
        <n-h1>{{ greetings }}</n-h1>
        <n-text depth="3">由此开启好心情 ~</n-text>
      </div>
      <!-- 刷新推荐数据 -->
      <n-button
        v-if="settingStore.useOnlineService"
        :focusable="false"
        circle
        strong
        secondary
        class="refresh"
        :loading="homeOnlineRef?.refreshing"
        @click="homeOnlineRef?.handleRefresh()"
      >
        <template #icon>
          <SvgIcon name="Refresh" :size="18" />
        </template>
      </n-button>
    </div>
    <!-- 在线模式 -->
    <HomeOnline v-if="settingStore.useOnlineService" ref="homeOnlineRef" />
    <!-- 本地模式 -->
    <HomeLocal v-else />
  </div>
</template>

<script setup lang="ts">
import { useSettingStore, useDataStore } from "@/stores";
import { getGreeting } from "@/utils/time";
import { isLogin } from "@/utils/auth";
import HomeOnline from "./HomeOnline.vue";
import HomeLocal from "./HomeLocal.vue";
import SvgIcon from "@/components/Global/SvgIcon.vue";

const settingStore = useSettingStore();
const dataStore = useDataStore();

// 在线模式组件实例，用于调用刷新
const homeOnlineRef = ref<InstanceType<typeof HomeOnline> | null>(null);

// 问候语
const greetings = computed(() => {
  const greeting = getGreeting();
  const name = isLogin() ? dataStore.userData.name : "";
  return name ? `${greeting}，${name}` : greeting;
});
</script>

<style lang="scss" scoped>
.home {
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  .welcome {
    margin-top: 8px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    .welcome-text {
      min-width: 0;
    }
    .n-h1 {
      margin: 0;
      font-weight: bold;
    }
    .refresh {
      flex-shrink: 0;
    }
  }
}
</style>
