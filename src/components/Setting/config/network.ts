import { useSettingStore } from "@/stores";
import { SettingConfig, settingValue } from "@/types/settings";
import { computed, ref, h, markRaw } from "vue";
import { NA } from "naive-ui";
import { getAuthToken, getAuthUrl, getSession } from "@/api/lastfm";
import StreamingServerList from "../components/StreamingServerList.vue";

export const useNetworkSettings = (): SettingConfig => {
  const settingStore = useSettingStore();

  // --- Last.fm 授权逻辑 ---
  const lastfmAuthLoading = ref(false);

  const connectLastfm = async () => {
    try {
      lastfmAuthLoading.value = true;
      const tokenResponse = await getAuthToken();
      if (!tokenResponse.token) throw new Error("无法获取认证令牌");
      const token = tokenResponse.token;
      const authUrl = getAuthUrl(token);

      if (typeof window !== "undefined") {
        const authWindow = window.open(authUrl, "_blank", "width=800,height=600");
        const checkAuth = setInterval(async () => {
          if (authWindow?.closed) {
            clearInterval(checkAuth);
            if (lastfmAuthLoading.value) {
              lastfmAuthLoading.value = false;
              window.$message.warning("授权已取消");
            }
            return;
          }
          try {
            const sessionResponse = await getSession(token);
            if (sessionResponse.session) {
              clearInterval(checkAuth);
              authWindow?.close();
              settingStore.lastfm.sessionKey = sessionResponse.session.key;
              settingStore.lastfm.username = sessionResponse.session.name;
              window.$message.success(`已成功连接到 Last.fm 账号: ${sessionResponse.session.name}`);
              lastfmAuthLoading.value = false;
            }
          } catch {
            // 用户还未授权，继续等待
          }
        }, 2000);

        setTimeout(() => {
          clearInterval(checkAuth);
          if (lastfmAuthLoading.value) {
            lastfmAuthLoading.value = false;
            window.$message.warning("授权超时，请重试");
          }
        }, 30000);
      }
    } catch (error: any) {
      console.error("Last.fm 连接失败:", error);
      window.$message.error(`连接失败: ${error.message || "未知错误"}`);
      lastfmAuthLoading.value = false;
    }
  };

  const disconnectLastfm = () => {
    window.$dialog.warning({
      title: "断开连接",
      content: "确定要断开与 Last.fm 的连接吗？",
      positiveText: "确定",
      negativeText: "取消",
      onPositiveClick: () => {
        settingStore.lastfm.sessionKey = "";
        settingStore.lastfm.username = "";
        window.$message.success("已断开与 Last.fm 的连接");
      },
    });
  };

  return {
    groups: [
      {
        title: "流媒体服务",
        items: [
          {
            key: "streamingEnabled",
            label: "启用流媒体",
            type: "switch",
            description: "开启后可使用并管理 Navidrome、Jellyfin 等流媒体服务",
            value: settingValue(
              () => settingStore.streamingEnabled,
              (v) => (settingStore.streamingEnabled = v),
            ),
          },
          {
            key: "serverList",
            label: "服务器管理",
            type: "custom",
            description: "在此添加和管理您的流媒体服务器",
            noWrapper: true,
            component: markRaw(StreamingServerList),
          },
        ],
      },
      {
        title: "网络代理",
        items: [
          {
            key: "useRealIP",
            label: "使用真实 IP 地址",
            type: "switch",
            description: "在海外或部分地区可能会受到限制，可开启此处尝试解决",
            value: settingValue(
              () => settingStore.useRealIP,
              (v) => (settingStore.useRealIP = v),
            ),
          },
          {
            key: "realIP",
            label: "真实 IP 地址",
            type: "text-input",
            description: "可在此处输入国内 IP，不填写则为随机",
            disabled: computed(() => !settingStore.useRealIP),
            prefix: "IP",
            componentProps: { placeholder: "127.0.0.1" },
            value: settingValue(
              () => settingStore.realIP,
              (v) => (settingStore.realIP = v),
            ),
          },
        ],
      },
      {
        title: "第三方集成",
        items: [
          {
            key: "smtcOpen",
            label: "开启浏览器媒体会话",
            type: "switch",
            description: "向浏览器发送 Media Session 媒体元数据",
            value: settingValue(
              () => settingStore.smtcOpen,
              (v) => (settingStore.smtcOpen = v),
            ),
          },
          {
            key: "lastfm_enabled",
            label: "启用 Last.fm",
            type: "switch",
            description: "开启后可记录播放历史到 Last.fm",
            value: settingValue(
              () => settingStore.lastfm.enabled,
              (v) => (settingStore.lastfm.enabled = v),
            ),
            children: [
              {
                key: "lastfm_apikey",
                label: "API Key",
                type: "text-input",
                description: () =>
                  h("div", null, [
                    h("div", null, [
                      "在 ",
                      h(
                        NA,
                        {
                          href: "https://www.last.fm/zh/api/account/create",
                          target: "_blank",
                        },
                        { default: () => "Last.fm 创建应用" },
                      ),
                      " 获取，只有「程序名称」是必要的",
                    ]),
                    h("div", null, [
                      "如果已经创建过，则可以在 ",
                      h(
                        NA,
                        {
                          href: "https://www.last.fm/zh/api/accounts",
                          target: "_blank",
                        },
                        { default: () => "Last.fm API 应用程序" },
                      ),
                      " 处查看",
                    ]),
                  ]),
                value: settingValue(
                  () => settingStore.lastfm.apiKey,
                  (v) => (settingStore.lastfm.apiKey = v),
                ),
              },
              {
                key: "lastfm_secret",
                label: "API Secret",
                type: "text-input",
                description: "Shared Secret，用于签名验证",
                componentProps: { type: "password", showPasswordOn: "click" },
                value: settingValue(
                  () => settingStore.lastfm.apiSecret,
                  (v) => (settingStore.lastfm.apiSecret = v),
                ),
              },
              {
                key: "lastfm_connect",
                label: computed(() =>
                  !settingStore.lastfm.sessionKey ? "连接 Last.fm 账号" : "已连接账号",
                ),
                type: "button",
                description: computed(() =>
                  !settingStore.lastfm.sessionKey
                    ? "首次使用需要授权连接"
                    : settingStore.lastfm.username,
                ),
                buttonLabel: computed(() =>
                  !settingStore.lastfm.sessionKey ? "连接账号" : "断开连接",
                ),
                action: () =>
                  !settingStore.lastfm.sessionKey ? connectLastfm() : disconnectLastfm(),
                componentProps: computed(() =>
                  !settingStore.lastfm.sessionKey
                    ? {
                        type: "primary",
                        loading: lastfmAuthLoading.value,
                        disabled: !settingStore.isLastfmConfigured,
                      }
                    : { type: "error" },
                ),
              },
              {
                key: "lastfm_scrobble",
                label: "Scrobble（播放记录）",
                type: "switch",
                description: "自动记录播放历史到 Last.fm",
                condition: () => !!settingStore.lastfm.sessionKey,
                value: settingValue(
                  () => settingStore.lastfm.scrobbleEnabled,
                  (v) => (settingStore.lastfm.scrobbleEnabled = v),
                ),
              },
              {
                key: "lastfm_nowplaying",
                label: "正在播放状态",
                type: "switch",
                description: "向 Last.fm 同步正在播放的歌曲",
                condition: () => !!settingStore.lastfm.sessionKey,
                value: settingValue(
                  () => settingStore.lastfm.nowPlayingEnabled,
                  (v) => (settingStore.lastfm.nowPlayingEnabled = v),
                ),
              },
            ],
          },
        ],
      },
    ],
  };
};
