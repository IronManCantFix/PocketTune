import { useDataStore, useSettingStore } from "@/stores";
import { openExcludeComment } from "@/utils/modal";
import SongUnlockManager from "@/components/Modal/Setting/SongUnlockManager.vue";
import UnblockSources from "../components/UnblockSources.vue";
import { SettingConfig } from "@/types/settings";

export const useGeneralSettings = (): SettingConfig => {
  const dataStore = useDataStore();
  const settingStore = useSettingStore();

  // --- 重置逻辑 ---
  const resetSetting = () => {
    window.$dialog.warning({
      title: "警告",
      content: "此操作将重置所有设置，是否继续?",
      positiveText: "确定",
      negativeText: "取消",
      onPositiveClick: () => {
        settingStore.$reset();
        window.$message.success("设置重置完成");
      },
    });
  };

  const clearAllData = () => {
    window.$dialog.warning({
      title: "高危操作",
      content: "此操作将重置所有设置并清除全部数据，同时将退出登录状态，是否继续?",
      positiveText: "确定",
      negativeText: "取消",
      onPositiveClick: async () => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        await dataStore.deleteDB();
        window.$message.loading("数据清除完成，软件即将热重载", {
          duration: 3000,
          onAfterLeave: () => window.location.reload(),
        });
      },
    });
  };

  return {
    groups: [
      {
        title: "搜索设置",
        items: [
          {
            key: "showSearchHistory",
            label: "显示搜索历史",
            description: "是否在搜索框的默认显示内容中显示当前搜索历史",
            type: "switch",
            value: computed({
              get: () => settingStore.showSearchHistory,
              set: (v) => (settingStore.showSearchHistory = v),
            }),
          },
          {
            key: "showHotSearch",
            label: "显示热搜榜",
            type: "switch",
            show: computed(() => settingStore.useOnlineService),
            description: "是否在搜索框的默认显示内容中显示热搜榜单",
            value: computed({
              get: () => settingStore.showHotSearch,
              set: (v) => (settingStore.showHotSearch = v),
            }),
          },
          {
            key: "enableSearchKeyword",
            label: "搜索关键词建议",
            type: "switch",
            show: computed(() => settingStore.useOnlineService),
            description: "将搜索框闲置时的默认显示内容替换为搜索关键词建议",
            value: computed({
              get: () => settingStore.enableSearchKeyword,
              set: (v) => (settingStore.enableSearchKeyword = v),
            }),
          },
          {
            key: "searchInputBehavior",
            label: "搜索框行为",
            type: "select",
            description: "自定义搜索框的行为模式",
            options: [
              { label: "保留搜索词", value: "normal" },
              { label: "失焦后清空", value: "clear" },
              { label: "同步搜索词", value: "sync" },
            ],
            value: computed({
              get: () => settingStore.searchInputBehavior,
              set: (v) => (settingStore.searchInputBehavior = v),
            }),
          },
          {
            key: "hideBracketedContent",
            label: "隐藏括号与别名",
            type: "switch",
            description: "隐藏歌曲名与专辑名中的括号内容和别名",
            value: computed({
              get: () => settingStore.hideBracketedContent,
              set: (v) => (settingStore.hideBracketedContent = v),
            }),
          },
          {
            key: "configExcludeComment",
            label: "评论排除配置",
            type: "button",
            description: "配置排除评论的规则（关键词或正则表达式）",
            buttonLabel: "配置",
            action: openExcludeComment,
          },
        ],
      },
      {
        title: "其他设置",
        items: [
          {
            key: "shareUrlFormat",
            label: "分享链接格式",
            type: "select",
            description: "自定义分享链接的生成格式",
            options: [
              { label: "网页版", value: "web" },
              { label: "移动版", value: "mobile" },
            ],
            value: computed({
              get: () => settingStore.shareUrlFormat,
              set: (v) => (settingStore.shareUrlFormat = v),
            }),
          },
        ],
      },
      {
        title: "音乐解锁",
        items: [
          {
            key: "useSongUnlock",
            label: "启用歌曲解锁",
            type: "switch",
            description: "对灰色/无版权歌曲尝试解锁播放",
            value: computed({
              get: () => settingStore.useSongUnlock,
              set: (v) => (settingStore.useSongUnlock = v),
            }),
          },
          {
            key: "unblockSources",
            label: "解灰音源",
            type: "custom",
            description: "调整服务端解灰音源的启用与优先级",
            noWrapper: true,
            component: markRaw(UnblockSources),
          },
          {
            key: "songUnlockServer",
            label: "回退音源",
            type: "custom",
            description: "解灰失败时的备用直连音源顺序",
            noWrapper: true,
            component: markRaw(SongUnlockManager),
          },
        ],
      },
      {
        title: "重置",
        items: [
          {
            key: "resetSetting",
            label: "重置所有设置",
            type: "button",
            description: "重置所有设置，恢复软件默认值",
            buttonLabel: "重置设置",
            action: resetSetting,
            componentProps: { type: "warning" },
          },
          {
            key: "clearAllData",
            label: "清除全部数据",
            type: "button",
            description: "重置所有设置，清除全部数据",
            buttonLabel: "清除全部",
            action: clearAllData,
            componentProps: { type: "error" },
          },
        ],
      },
    ],
  };
};
