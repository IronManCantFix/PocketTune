import type { VNodeChild } from "vue";
import { useSettingStore } from "@/stores";
import { checkIsolationSupport } from "@/utils/env";
import { renderOption } from "@/utils/helper";
import { SettingConfig, settingValue } from "@/types/settings";
import { AI_AUDIO_LEVELS } from "@/utils/meta";
import { NTooltip, type SelectOption } from "naive-ui";

import { computed, h, watch } from "vue";

export const usePlaySettings = (): SettingConfig => {
  const settingStore = useSettingStore();

  // 音频引擎数据
  const audioEngineData = {
    element: {
      label: "Web Audio",
      value: "element",
      tip: "浏览器原生播放引擎，稳定可靠占用低，但不支持部分音频格式",
    },
    ffmpeg: {
      label: "FFmpeg",
      value: "ffmpeg",
      tip: "FFmpeg 播放引擎，支持更多音频格式，但不支持部分功能，如倍速播放",
    },
  };

  // 引擎提示文案
  const engineTip = computed(
    () => audioEngineData[settingStore.audioEngine as keyof typeof audioEngineData]?.tip,
  );

  // 音频引擎选项渲染函数 (处理禁用状态的 Tooltip)
  const renderAudioEngineOption = ({
    node,
    option,
  }: {
    node: VNodeChild;
    option: SelectOption;
  }) => {
    if (option.value === "ffmpeg" && option.disabled) {
      return h(
        NTooltip,
        { placement: "left", keepAliveOnHover: false },
        {
          trigger: () => h("div", { style: "cursor: not-allowed;" }, [node]),
          default: () => "当前环境不支持 FFmpeg",
        },
      );
    }
    return node;
  };

  // 组合下拉选项
  const audioEngineOptions = [
    { label: "Web Audio (默认)", value: "element" },
    {
      label: "FFmpeg",
      value: "ffmpeg",
      disabled: !checkIsolationSupport(),
    },
  ];

  // 当前选中的引擎值
  const audioEngineSelectValue = computed<"element" | "ffmpeg" | "mpv">(() =>
    settingStore.playbackEngine === "mpv" ? "mpv" : settingStore.audioEngine,
  );

  // 处理引擎切换
  const handleAudioEngineSelect = (value: "element" | "ffmpeg" | "mpv") => {
    if (value === "ffmpeg" && !checkIsolationSupport()) {
      window.$message.warning("当前环境不支持 FFmpeg 引擎，已回退至默认引擎");
      return;
    }

    const targetPlaybackEngine = value === "mpv" ? "mpv" : "web-audio";
    // 如果是切回 web-audio，且 value 为 element/ffmpeg，则更新 audioEngine
    const targetAudioEngine = value !== "mpv" ? value : settingStore.audioEngine;

    // 检查是否有变化
    if (
      targetPlaybackEngine === settingStore.playbackEngine &&
      targetAudioEngine === settingStore.audioEngine
    ) {
      return;
    }

    window.$dialog.warning({
      title: "更换播放引擎",
      content: "更换播放引擎需要重启应用以确保设置生效，是否立即重启？",
      positiveText: "重启",
      negativeText: "取消",
      onPositiveClick: () => {
        // 切换引擎类型时重置为目标引擎的默认设备，避免跨引擎设备 ID 不兼容
        if (targetPlaybackEngine !== settingStore.playbackEngine) {
          settingStore.playDevice = targetPlaybackEngine === "mpv" ? "auto" : "default";
        }
        settingStore.playbackEngine = targetPlaybackEngine;
        settingStore.audioEngine = targetAudioEngine;
        window.location.reload();
      },
    });
  };

  // 归一化历史遗留的 MPV 引擎值
  watch(
    () => settingStore.playbackEngine,
    () => {
      if (settingStore.playbackEngine === "mpv") {
        settingStore.playbackEngine = "web-audio";
      }
    },
    { immediate: true },
  );

  // 音质数据
  const songLevelData: Record<string, { label: string; tip: string; value: string }> = {
    standard: { label: "标准音质", tip: "标准音质 128kbps", value: "standard" },
    higher: { label: "较高音质", tip: "较高音质 328kbps", value: "higher" },
    exhigh: { label: "极高 (HQ)", tip: "近CD品质的细节体验，最高320kbps", value: "exhigh" },
    lossless: { label: "无损 (SQ)", tip: "高保真无损音质，最高48kHz/16bit", value: "lossless" },
    hires: {
      label: "高解析度无损 (Hi-Res)",
      tip: "更饱满清晰的高解析度音质，最高192kHz/24bit",
      value: "hires",
    },
    jyeffect: {
      label: "高清臻音 (Spatial Audio)",
      tip: "声音听感增强，96kHz/24bit",
      value: "jyeffect",
    },
    jymaster: { label: "超清母带 (Master)", tip: "还原音频细节，192kHz/24bit", value: "jymaster" },
    sky: {
      label: "沉浸环绕声 (Surround Audio)",
      tip: "沉浸式空间环绕音感，最高5.1声道",
      value: "sky",
    },
    vivid: {
      label: "臻音全景声 (Audio Vivid)",
      tip: "极致沉浸三维空间音频，最高7.1.4声道",
      value: "vivid",
    },
    dolby: {
      label: "杜比全景声 (Dolby Atmos)",
      tip: "杜比全景声音乐，沉浸式聆听体验",
      value: "dolby",
    },
  };

  // 动态计算音质选项
  const songLevelOptions = computed(() => {
    const options = Object.values(songLevelData);

    if (settingStore.disableAiAudio) {
      return options.filter((option) => {
        if (option.value === "dolby") return true;
        // 正确的类型转换或检查
        return !AI_AUDIO_LEVELS.includes(option.value);
      });
    }
    return options;
  });

  // 监听 Fuck AI Mode，重置不合法音质
  watch(
    () => settingStore.disableAiAudio,
    (val) => {
      if (!val) return;
      // 正确的类型检查
      if (AI_AUDIO_LEVELS.includes(settingStore.songLevel)) {
        settingStore.songLevel = "hires";
      }
    },
  );

  return {
    groups: [
      {
        title: "播放控制",
        items: [
          {
            key: "useNextPrefetch",
            label: "下一首歌曲预载",
            type: "switch",
            description: "提前预加载下一首歌曲的播放地址，提升切换速度",
            value: settingValue(
              () => settingStore.useNextPrefetch,
              (v) => (settingStore.useNextPrefetch = v),
            ),
          },
          {
            key: "memoryLastSeek",
            label: "记忆上次播放位置",
            type: "switch",
            description: "程序启动时恢复上次播放位置",
            value: settingValue(
              () => settingStore.memoryLastSeek,
              (v) => (settingStore.memoryLastSeek = v),
            ),
          },
          {
            key: "preventSleep",
            label: "阻止系统息屏",
            type: "switch",
            description: "是否在播放界面阻止系统息屏",
            value: settingValue(
              () => settingStore.preventSleep,
              (v) => (settingStore.preventSleep = v),
            ),
          },
          {
            key: "progressTooltipShow",
            label: "显示进度条悬浮信息",
            type: "switch",
            value: settingValue(
              () => settingStore.progressTooltipShow,
              (v) => (settingStore.progressTooltipShow = v),
            ),
            children: [
              {
                key: "progressLyricShow",
                label: "进度条悬浮时显示歌词",
                type: "switch",
                value: settingValue(
                  () => settingStore.progressLyricShow,
                  (v) => (settingStore.progressLyricShow = v),
                ),
              },
            ],
          },
          {
            key: "progressAdjustLyric",
            label: "进度调节吸附最近歌词",
            type: "switch",
            description: "进度调节时从当前时间最近一句歌词开始播放",
            value: settingValue(
              () => settingStore.progressAdjustLyric,
              (v) => (settingStore.progressAdjustLyric = v),
            ),
          },
          {
            key: "songVolumeFade",
            label: "音乐渐入渐出",
            type: "switch",
            value: settingValue(
              () => settingStore.songVolumeFade,
              (v) => (settingStore.songVolumeFade = v),
            ),
            children: [
              {
                key: "songVolumeFadeTime",
                label: "渐入渐出时长",
                type: "input-number",
                description: "单位 ms，最小 200，最大 2000",
                min: 200,
                max: 2000,
                suffix: "ms",
                value: settingValue(
                  () => settingStore.songVolumeFadeTime,
                  (v) => (settingStore.songVolumeFadeTime = v),
                ),
              },
            ],
          },
          {
            key: "enableAutomix",
            label: "启用自动混音",
            type: "switch",
            tags: [{ text: "Beta", type: "warning" }],
            description: computed(() =>
              settingStore.playbackEngine === "web-audio"
                ? "是否启用自动混音功能"
                : "自动混音功能仅在使用 Web Audio 引擎时可用",
            ),
            value: settingValue(
              () => settingStore.enableAutomix,
              (v) => {
                if (v) {
                  window.$dialog.warning({
                    title: "启用自动混音 (Beta)",
                    content:
                      "可能出现兼容性问题，该功能在早期测试，遇到问题请反馈issue，不保证可以及时处理。效果可能因为歌曲而异，保守策略。",
                    positiveText: "开启",
                    negativeText: "取消",
                    onPositiveClick: () => {
                      settingStore.enableAutomix = true;
                    },
                  });
                } else {
                  settingStore.enableAutomix = v;
                }
              },
            ),
            disabled: computed(() => settingStore.playbackEngine !== "web-audio"),
            children: [
              {
                key: "automixMaxAnalyzeTime",
                label: "最大分析时间",
                type: "input-number",
                description: "单位秒，越长越精准但更耗时 (建议 60s)",
                min: 5,
                max: 300,
                suffix: "s",
                value: settingValue(
                  () => settingStore.automixMaxAnalyzeTime,
                  (v) => (settingStore.automixMaxAnalyzeTime = v),
                ),
              },
            ],
          },
        ],
      },
      {
        title: "音频设置",
        items: [
          {
            key: "songLevel",
            label: "在线歌曲音质",
            type: "select",
            description: () => songLevelData[settingStore.songLevel]?.tip,
            options: songLevelOptions,
            componentProps: {
              renderOption,
            },
            value: settingValue(
              () => settingStore.songLevel,
              (v) => (settingStore.songLevel = v),
            ),
          },
          {
            key: "disableAiAudio",
            label: "Fuck AI Mode",
            type: "switch",
            description:
              "开启后将隐藏部分 AI 增强音质选项（如超清母带、沉浸环绕声等），但会保留杜比全景声",
            value: settingValue(
              () => settingStore.disableAiAudio,
              (v) => (settingStore.disableAiAudio = v),
            ),
          },
          {
            key: "disableDjMode",
            label: "Fuck DJ Mode",
            type: "switch",
            description: "歌曲名字带有 DJ 抖音 0.9 0.8 网红 车载 热歌 慢摇 自动跳过",
            value: settingValue(
              () => settingStore.disableDjMode,
              (v) => (settingStore.disableDjMode = v),
            ),
          },
          {
            key: "uncensorMaskedProfanity",
            label: "Fuck *** Mode",
            type: "switch",
            description: "把歌词里的 f**k 等屏蔽词还原为原词",
            value: settingValue(
              () => settingStore.uncensorMaskedProfanity,
              (v) => (settingStore.uncensorMaskedProfanity = v),
            ),
          },
          {
            key: "audioEngine",
            label: "音频处理引擎",
            type: "select",
            tags: [{ text: "Beta", type: "warning" }],
            description: () =>
              h("div", [
                h("span", null, engineTip.value),
                h("br"),
                h(NTooltip, null, {
                  default: () => "重启应用以生效",
                  trigger: () =>
                    h("span", { style: "color: var(--n-warning-color);" }, "重启应用以生效"),
                }),
              ]),
            options: audioEngineOptions,
            componentProps: {
              renderOption: renderAudioEngineOption,
            },
            value: settingValue(
              () => audioEngineSelectValue.value,
              (v) => handleAudioEngineSelect(v),
            ),
          },
          {
            key: "audioLatencyHint",
            label: "Web Audio 延迟策略",
            type: "select",
            tags: [{ text: "Beta", type: "warning" }],
            description:
              "调整 Web Audio 的延迟策略，修改后需重启。<br>" +
              "“低延迟模式（interactive）”延迟更低但可能不稳定；<br>" +
              "“高效能模式（playback）”延迟偏高但播放更稳定。<br>" +
              "已针对“高效能模式（playback）”补偿了音频输出延迟，理论上不会造成歌词与音频不同步的问题。",
            options: [
              { label: "低延迟模式（interactive）", value: "interactive" },
              { label: "高效能模式（playback）", value: "playback" },
            ],
            value: settingValue(
              () => settingStore.audioLatencyHint,
              (v) => {
                window.$dialog.warning({
                  title: "更改延迟策略",
                  content: "此操作需要重启应用才能生效，是否立即重启？",
                  positiveText: "重启",
                  negativeText: "取消",
                  onPositiveClick: () => {
                    settingStore.audioLatencyHint = v;
                    window.location.reload();
                  },
                });
              },
            ),
            show: computed(
              () =>
                settingStore.playbackEngine === "web-audio" &&
                settingStore.audioEngine === "element",
            ),
          },
          {
            key: "audioDelayCompensation",
            label: "音频与歌词同步补偿",
            type: "input-number",
            description:
              "手动补偿音频与歌词进度延迟。<br>正值歌词变快，负值歌词进度变慢。<br>适用于移动端等自动延迟检测不准的设备。",
            tags: [{ text: "Beta", type: "warning" }],
            show: computed(() => settingStore.audioLatencyHint === "playback"),
            min: -1000,
            max: 1000,
            step: 10,
            suffix: "ms",
            value: settingValue(
              () => settingStore.audioDelayCompensation,
              (v) => (settingStore.audioDelayCompensation = v ?? 0),
            ),
            defaultValue: 0,
          },
          {
            key: "playSongDemo",
            label: "播放试听",
            type: "switch",
            description: "是否在非会员状态下播放试听歌曲",
            value: settingValue(
              () => settingStore.playSongDemo,
              (v) => (settingStore.playSongDemo = v),
            ),
          },
          {
            key: "enableReplayGain",
            label: "音量平衡",
            type: "switch",
            description:
              "平衡不同音频内容之间的音量大小（需要本地歌曲标签中有 replayGain 数据才会生效）",
            value: settingValue(
              () => settingStore.enableReplayGain,
              (v) => (settingStore.enableReplayGain = v),
            ),
            children: [
              {
                key: "replayGainMode",
                label: "平衡模式",
                type: "select",
                description: "选择音量平衡的计算基准",
                options: [
                  { label: "单曲 (Track)", value: "track" },
                  { label: "专辑 (Album)", value: "album" },
                ],
                value: settingValue(
                  () => settingStore.replayGainMode,
                  (v) => (settingStore.replayGainMode = v),
                ),
              },
            ],
          },
        ],
      },
    ],
  };
};
