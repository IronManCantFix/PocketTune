<template>
  <n-layout-header class="nav">
    <!-- 移动端菜单按钮（左侧） -->
    <n-button
      v-if="!isDesktop"
      :focusable="false"
      tertiary
      circle
      class="mobile-menu-btn"
      @click="showAside = !showAside"
    >
      <template #icon>
        <SvgIcon name="Menu" />
      </template>
    </n-button>
    <!-- 页面导航 -->
    <n-flex class="page-control">
      <Logo v-if="!isDesktop" :size="40" @click="router.push('/')" />
      <template v-if="!isSmallScreen">
        <n-button :focusable="false" tertiary circle @click="router.go(-1)">
          <template #icon>
            <SvgIcon name="NavigateBefore" :size="26" />
          </template>
        </n-button>
        <n-button :focusable="false" tertiary circle @click="router.go(1)">
          <template #icon>
            <SvgIcon name="NavigateNext" :size="26" />
          </template>
        </n-button>
      </template>
    </n-flex>
    <!-- 主内容 -->
    <n-flex :wrap="false" justify="end" class="nav-main">
      <!-- 搜索 -->
      <SearchInp v-if="settingStore.useOnlineService" />
      <!-- 可拖拽 -->
      <div v-if="isDesktop" class="nav-drag" />
      <n-flex align="center">
        <!-- 用户 -->
        <User v-if="settingStore.useOnlineService" />
        <!-- 设置菜单 -->
        <n-dropdown :options="setOptions" trigger="click" @select="setSelect">
          <n-button :focusable="false" title="设置" tertiary circle>
            <template #icon>
              <SvgIcon name="Settings" />
            </template>
          </n-button>
        </n-dropdown>
      </n-flex>
    </n-flex>
    <!-- 抽屉 -->
    <n-drawer v-model:show="showAside" :width="240" placement="left">
      <n-drawer-content
        :body-content-style="{ padding: 0 }"
        :native-scrollbar="false"
        :style="{ paddingTop: 'env(safe-area-inset-top, 0px)' }"
      >
        <template #header>
          <n-flex align="center" class="aside-logo">
            <Logo />
            <n-text>PocketTune</n-text>
          </n-flex>
        </template>
        <Menu @menu-click="showAside = false" />
      </n-drawer-content>
    </n-drawer>
  </n-layout-header>
</template>

<script setup lang="ts">
import type { DropdownOption } from "naive-ui";
import { useSettingStore, useStatusStore } from "@/stores";
import { renderIcon } from "@/utils/helper";
import { openSetting, openThemeConfig } from "@/utils/modal";
import { useMobile } from "@/composables/useMobile";

const router = useRouter();
const settingStore = useSettingStore();
const statusStore = useStatusStore();
const { isDesktop, isSmallScreen } = useMobile();

// 是否显示侧边栏
const showAside = ref(false);

// 设置菜单
const setOptions = computed<DropdownOption[]>(() => [
  {
    label:
      settingStore.themeMode === "auto"
        ? "浅色模式"
        : settingStore.themeMode === "light"
          ? "深色模式"
          : "跟随系统",
    key: "themeMode",
    disabled: !!statusStore.backgroundImageUrl,
    icon: renderIcon(
      settingStore.themeMode === "auto"
        ? "LightTheme"
        : settingStore.themeMode === "light"
          ? "DarkTheme"
          : "AutoTheme",
    ),
  },
  {
    label: "主题配置",
    key: "themeConfig",
    icon: renderIcon("Palette"),
  },
  {
    key: "setting",
    label: "全局设置",
    icon: renderIcon("Settings"),
  },
]);

// 菜单选择
const setSelect = (key: string) => {
  switch (key) {
    case "themeMode":
      settingStore.setThemeMode();
      break;
    case "themeConfig":
      openThemeConfig();
      break;
    case "setting":
      openSetting();
      break;
  }
};
</script>

<style lang="scss" scoped>
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  // 固定高度，移动端搜索栏紧贴屏幕顶部，避免顶部出现空洞
  height: calc(70px + env(safe-area-inset-top, 0px));
  padding: 0 1rem;
  padding-top: env(safe-area-inset-top, 0px);
  background-color: transparent;
  // 左侧控制区域宽度变量，供搜索框计算可用空间
  --nav-page-control-width: 180px;
  --nav-page-control-max-width: 220px;
  --nav-page-control-width-small: 160px;
  .n-button {
    width: 40px;
    height: 40px;
  }
  .mobile-menu-btn {
    flex-shrink: 0;
    margin-right: 8px;
  }
  .nav-main {
    position: relative;
    flex: 1;
    align-items: center;
    height: 100%;
    margin-left: 12px;
    .nav-drag {
      flex: 1;
      width: 100%;
      height: 100%;
    }
  }
}
.aside-logo {
  .n-text {
    // 不锁宽，品牌名放不下时不换行而是整体靠左展示
    flex: 1 1 auto;
    min-width: 0;
    font-size: 22px;
    font-family: "logo";
    margin-top: 2px;
    line-height: 40px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
