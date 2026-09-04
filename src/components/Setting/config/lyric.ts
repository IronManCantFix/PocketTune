import { useLyricManager } from "@/core/player/LyricManager";
import { useSettingStore } from "@/stores";
import { SettingConfig, settingValue } from "@/types/settings";
import { descMultiline } from "@/utils/format";
import { openAMLLServer, openExcludeLyric, openFontManager } from "@/utils/modal";
import LyricPreview from "../components/LyricPreview.vue";

export const useLyricSettings = (): SettingConfig => {
  const settingStore = useSettingStore();
  const lyricManager = useLyricManager();

  return {
    groups: [
      {
        title: "歌词设置",
        items: [
          {
            key: "lyricPreview",
            label: "预览",
            type: "custom",
            noWrapper: true,
            component: markRaw(LyricPreview),
          },
          {
            key: "lyricFontSizeMode",
            label: "自适应歌词大小",
            type: "switch",
            description: "开启后歌词大小将根据窗口高度自动缩放，避免全屏时过小或窗口时过大",
            value: settingValue(
              () => settingStore.lyricFontSizeMode === "adaptive",
              (v) => (settingStore.lyricFontSizeMode = v ? "adaptive" : "fixed"),
            ),
          },
          {
            key: "lyricFontSize",
            label: "歌词字体大小",
            type: "input-number",
            description: computed(() =>
              settingStore.lyricFontSizeMode === "adaptive"
                ? "作为基准大小 (以 1080p 高度为准)"
                : "单位 px，最小 12，最大 60",
            ),
            min: 12,
            max: 60,
            suffix: "px",
            value: settingValue(
              () => settingStore.lyricFontSize,
              (v) => (settingStore.lyricFontSize = v || 30),
            ),
            defaultValue: 46,
          },
          {
            key: "lyricTranFontSize",
            label: "翻译歌词大小",
            type: "input-number",
            description: computed(() =>
              settingStore.lyricFontSizeMode === "adaptive"
                ? "作为基准大小 (以 1080p 高度为准)"
                : "单位 px，最小 5，最大 40",
            ),
            min: 5,
            max: 40,
            suffix: "px",
            value: settingValue(
              () => settingStore.lyricTranFontSize,
              (v) => (settingStore.lyricTranFontSize = v || 22),
            ),
            forceIf: {
              condition: () => settingStore.useAMLyrics,
              forcedValue: () => Math.max(0.5 * settingStore.lyricFontSize, 10),
              forcedTitle: "由 AMLL 自动控制",
            },
            defaultValue: 22,
          },
          {
            key: "lyricRomaFontSize",
            label: "音译歌词大小",
            type: "input-number",
            description: computed(() =>
              settingStore.lyricFontSizeMode === "adaptive"
                ? "作为基准大小 (以 1080p 高度为准)"
                : "单位 px，最小 5，最大 40",
            ),
            min: 5,
            max: 40,
            suffix: "px",
            value: settingValue(
              () => settingStore.lyricRomaFontSize,
              (v) => (settingStore.lyricRomaFontSize = v || 18),
            ),
            forceIf: {
              condition: () => settingStore.useAMLyrics,
              forcedValue: () => Math.max(0.5 * settingStore.lyricFontSize, 10),
              forcedTitle: "由 AMLL 自动控制",
            },
            defaultValue: 18,
          },
          {
            key: "fontConfig",
            label: "歌词字体设置",
            type: "button",
            description: "统一配置各语种歌词区域的字体",
            buttonLabel: "配置",
            action: openFontManager,
          },
          {
            key: "lyricFontWeight",
            label: "歌词字重设置",
            type: "input-number",
            description: "设置歌词显示的字重，部分字体可能不支持所有字重",
            min: 100,
            max: 900,
            step: 100,
            value: settingValue(
              () => settingStore.lyricFontWeight,
              (v) => (settingStore.lyricFontWeight = v),
            ),
          },
          {
            key: "lyricTransition",
            label: "歌词切换动画",
            type: "select",
            description: "底栏播放器歌词切换时的动画效果",
            options: [
              { label: "滑动", value: "slide" },
              { label: "淡入淡出", value: "fade" },
            ],
            value: settingValue(
              () => settingStore.lyricTransition,
              (v) => (settingStore.lyricTransition = v),
            ),
          },
          {
            key: "lyricsPosition",
            label: "歌词位置",
            type: "select",
            description: "歌词的默认垂直位置",
            options: [
              { label: "居左", value: "flex-start" },
              { label: "居中", value: "center" },
              { label: "居右", value: "flex-end" },
            ],
            value: settingValue(
              () => settingStore.lyricsPosition,
              (v) => (settingStore.lyricsPosition = v),
            ),
            forceIf: {
              condition: () => settingStore.useAMLyrics,
              forcedValue: "flex-start",
              forcedDescription: "歌词的默认垂直位置，AMLL 默认居左",
            },
          },
          {
            key: "lyricHorizontalOffset",
            label: "歌词左侧边距",
            type: "slider",
            description: "调整全屏模式下歌词的起始位置",
            min: 0,
            max: 200,
            step: 1,
            marks: { 10: "默认" },
            formatTooltip: (v) => `${v}px`,
            value: settingValue(
              () => settingStore.lyricHorizontalOffset,
              (v) => (settingStore.lyricHorizontalOffset = v),
            ),
          },
          {
            key: "lyricAlignRight",
            label: "默认歌词靠右",
            type: "switch",
            description: "左右对唱位置互换",
            value: settingValue(
              () => settingStore.lyricAlignRight,
              (v) => (settingStore.lyricAlignRight = v),
            ),
          },
          {
            key: "lyricsScrollOffset",
            label: "歌词滚动位置",
            type: "slider",
            description: "歌词高亮时在屏幕中的垂直位置",
            min: 0.1,
            max: 0.9,
            step: 0.05,
            marks: { 0.1: "靠上", 0.9: "靠下" },
            formatTooltip: (v) => `${(v * 100).toFixed(0)}%`,
            value: settingValue(
              () => settingStore.lyricsScrollOffset,
              (v) => (settingStore.lyricsScrollOffset = v),
            ),
          },
          {
            key: "showWordLyrics",
            label: "显示逐字歌词",
            type: "switch",
            description: "对性能要求较高，若发生卡顿请关闭",
            value: settingValue(
              () => settingStore.showWordLyrics,
              (v) => (settingStore.showWordLyrics = v),
            ),
          },
          {
            key: "showTran",
            label: "显示歌词翻译",
            type: "switch",
            value: settingValue(
              () => settingStore.showTran,
              (v) => (settingStore.showTran = v),
            ),
          },
          {
            key: "showRoma",
            label: "显示歌词音译",
            type: "switch",
            value: settingValue(
              () => settingStore.showRoma,
              (v) => (settingStore.showRoma = v),
            ),
          },
          {
            key: "swapTranRoma",
            label: "调换翻译与音译位置",
            type: "switch",
            description: "开启后音译显示在翻译上方",
            value: settingValue(
              () => settingStore.swapTranRoma,
              (v) => (settingStore.swapTranRoma = v),
            ),
            forceIf: {
              condition: () => !settingStore.showTran || !settingStore.showRoma,
              forcedValue: false,
            },
          },
          {
            key: "lyricsBlur",
            label: "歌词自动模糊",
            type: "switch",
            description: "是否聚焦显示当前播放行，其他行将模糊显示",
            value: settingValue(
              () => settingStore.lyricsBlur,
              (v) => (settingStore.lyricsBlur = v),
            ),
          },
          {
            key: "lyricsBlendMode",
            label: "歌词混合模式",
            type: "select",
            description: "全屏歌词区域的颜色混合模式",
            options: [
              { label: "Screen", value: "screen" },
              { label: "Plus Lighter", value: "plus-lighter" },
            ],
            value: settingValue(
              () => settingStore.lyricsBlendMode,
              (v) => (settingStore.lyricsBlendMode = v),
            ),
          },
          {
            key: "lyricOffsetStep",
            label: "歌词时延调节步长",
            type: "input-number",
            description: "单位毫秒，每次点击调节的时延大小",
            min: 10,
            max: 10000,
            step: 10,
            suffix: "ms",
            value: settingValue(
              () => settingStore.lyricOffsetStep,
              (v) => (settingStore.lyricOffsetStep = v || 500),
            ),
            defaultValue: 500,
          },
        ],
      },
      {
        title: "歌词内容",
        items: [
          {
            key: "lyricPriority",
            label: "歌词源优先级",
            type: "select",
            description: "设置歌词获取的优先顺序",
            options: computed(() => {
              const options = [{ label: "自动", value: "auto" }];
              if (settingStore.enableQQMusicLyric) {
                options.push({ label: "QM 优先", value: "qm" });
              }
              if (settingStore.enableOnlineTTMLLyric) {
                options.push({ label: "TTML 优先", value: "ttml" });
              }
              return options;
            }),
            value: settingValue(
              () => settingStore.lyricPriority,
              (v) => lyricManager.switchLyricSource(v),
            ),
          },
          {
            key: "preferTraditionalChinese",
            label: "更喜欢繁体中文",
            type: "switch",
            description: "将简体中文的歌词文本和翻译内容转换为繁体中文",
            value: settingValue(
              () => settingStore.preferTraditionalChinese,
              (v) => (settingStore.preferTraditionalChinese = v),
            ),
            children: [
              {
                key: "traditionalChineseVariant",
                label: "繁体中文变体",
                type: "select",
                description: "偏好的繁体中文变体",
                options: [
                  { label: "繁体中文 (标准)", value: "s2t" },
                  { label: "台湾正体", value: "s2tw" },
                  { label: "香港繁体", value: "s2hk" },
                ],
                value: settingValue(
                  () => settingStore.traditionalChineseVariant,
                  (v) => (settingStore.traditionalChineseVariant = v),
                ),
              },
            ],
          },
          {
            key: "enableOnlineTTMLLyric",
            label: "启用在线 TTML 歌词",
            type: "switch",
            description:
              "是否从 AMLL TTML DB 获取歌词（如有），TTML 歌词支持逐字、翻译、音译等功能，将会在下一首歌生效",
            tags: [{ text: "Beta", type: "warning" }],
            value: settingValue(
              () => settingStore.enableOnlineTTMLLyric,
              (v) => (settingStore.enableOnlineTTMLLyric = v),
            ),
            children: [
              {
                key: "amllDbServer",
                label: "AMLL TTML DB 地址",
                type: "button",
                description: "AMLL TTML DB 地址，请确保地址正确，否则将导致歌词获取失败",
                buttonLabel: "配置",
                action: openAMLLServer,
              },
            ],
          },
          {
            key: "configExcludeLyric",
            label: "歌词排除配置",
            type: "button",
            description: "可配置排除歌词，包含关键词或匹配正则表达式的歌词行将不会显示",
            buttonLabel: "配置",
            action: openExcludeLyric,
          },
          {
            key: "replaceLyricBrackets",
            label: "替换歌词括号内容",
            type: "switch",
            description: "将歌词中的括号内容替换为指定格式",
            value: settingValue(
              () => settingStore.replaceLyricBrackets,
              (v) => (settingStore.replaceLyricBrackets = v),
            ),
            children: [
              {
                key: "bracketReplacementPreset",
                label: "括号替换样式",
                type: "select",
                description: "选择替换后的括号样式",
                options: [
                  { label: "连字符 ( - )", value: "dash" },
                  { label: "六角括号 (〔 〕)", value: "angleBrackets" },
                  { label: "直角引号 (「 」)", value: "cornerBrackets" },
                  { label: "自定义", value: "custom" },
                ],
                value: settingValue(
                  () => settingStore.bracketReplacementPreset,
                  (v) => (settingStore.bracketReplacementPreset = v),
                ),
                condition: () => settingStore.bracketReplacementPreset === "custom",
                children: [
                  {
                    key: "customBracketReplacement",
                    label: "自定义替换内容",
                    type: "text-input",
                    description:
                      "输入自定义的替换字符。支持单个分隔符（如 - ）或成对符号（如 () ）",
                    value: settingValue(
                      () => settingStore.customBracketReplacement,
                      (v) => {
                        if (v.trim().length > 5) {
                          window.$message.warning("自定义替换内容不能超过 5 个字符");
                          return;
                        }
                        settingStore.customBracketReplacement = v;
                      },
                    ),
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        title: "Apple Music-like Lyrics",
        tags: [{ text: "Beta", type: "warning" }],
        items: [
          {
            key: "useAMLyrics",
            label: "使用 Apple Music-like Lyrics",
            type: "switch",
            description: "歌词使用 Apple Music-like Lyrics 进行渲染，需要高性能设备",
            value: settingValue(
              () => settingStore.useAMLyrics,
              (v) => (settingStore.useAMLyrics = v),
            ),
            children: [
              {
                key: "useAMSpring",
                label: "歌词弹簧效果",
                type: "switch",
                description: "是否使用物理弹簧算法实现歌词动画效果，需要高性能设备",
                value: settingValue(
                  () => settingStore.useAMSpring,
                  (v) => (settingStore.useAMSpring = v),
                ),
              },
              {
                key: "hidePassedLines",
                label: "隐藏已播放歌词",
                type: "switch",
                description: "是否隐藏已播放歌词",
                value: settingValue(
                  () => settingStore.hidePassedLines,
                  (v) => (settingStore.hidePassedLines = v),
                ),
              },
              {
                key: "wordFadeWidth",
                label: "文字动画的渐变宽度",
                type: "input-number",
                description: descMultiline`
                  单位以歌词行的主文字字体大小的倍数为单位
                  默认为 0.5，即一个全角字符的一半宽度
                  若模拟 Apple Music for Android 的效果，可以设为 1
                  若模拟 Apple Music for iPad 的效果，可以设为 0.5
                  若需近乎禁用渐变，可设为非常接近 0 的小数，如 0.01
                `,
                min: 0.01,
                max: 1,
                step: 0.01,
                value: settingValue(
                  () => settingStore.wordFadeWidth,
                  (v) => (settingStore.wordFadeWidth = v),
                ),
              },
              {
                key: "showWordsRoma",
                label: "显示逐字音译",
                type: "switch",
                value: settingValue(
                  () => settingStore.showWordsRoma,
                  (v) => (settingStore.showWordsRoma = v),
                ),
              },
            ],
          },
        ],
      },
    ],
  };
};
