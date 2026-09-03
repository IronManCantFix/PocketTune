import { QualityType, SongType, UpdateLogType } from "@/types/main";
import { AI_AUDIO_LEVELS, AI_AUDIO_KEYS } from "@/utils/meta";
import { NTooltip, SelectOption } from "naive-ui";
import { h, VNode } from "vue";
import { getCacheData } from "./cache";
import { updateLog } from "@/api/other";
import { isEmpty } from "lodash-es";
import { convertToLocalTime } from "./time";
import { useSettingStore } from "@/stores";
import { marked } from "marked";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import Fuse from "fuse.js";

type AnyObject = { [key: string]: any };

/**
 * 打开链接
 * @param url 链接地址
 * @param target 打开方式（_self 或 _blank）
 */
export const openLink = (url: string, target: "_self" | "_blank" = "_blank") => {
  window.open(url, target);
};

/**
 * 渲染图标
 * @param iconName 图标名称
 * @param option 图标选项（大小和样式）
 * @returns 图标组件
 */
export const renderIcon = (
  iconName: string,
  option: {
    size?: number;
    style?: AnyObject;
  } = {},
) => {
  const { size, style } = option;
  return () => {
    return h(SvgIcon, { name: iconName, size, style });
  };
};

/**
 * 延时函数
 * @param ms 延时时间（毫秒）
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * 渲染选项
 * @param param0 包含节点和选项的对象
 * @returns 包含工具提示的节点
 */
export const renderOption = ({ node, option }: { node: VNode; option: SelectOption }) =>
  h(
    NTooltip,
    { placement: "left" },
    {
      trigger: () => node,
      default: () => option.label,
    },
  );

/**
 * 模糊搜索
 * @param keyword 搜索关键词
 * @param data 要搜索的数据数组
 * @returns 包含匹配项的数组
 */
export const fuzzySearch = (keyword: string, data: SongType[]): SongType[] => {
  try {
    if (!keyword || !data || !Array.isArray(data)) return [];

    const fuse = new Fuse(data, {
      // 针对歌曲可读字段进行索引
      keys: [
        { name: "name", weight: 0.5 },
        { name: "alia", weight: 0.2 },
        { name: "artists", weight: 0.15 },
        { name: "artists.name", weight: 0.15 },
        { name: "album", weight: 0.1 },
        { name: "album.name", weight: 0.1 },
        { name: "dj.name", weight: 0.05 },
      ],
      threshold: 0.35, // 0 精确匹配 ~ 1 完全模糊
      ignoreLocation: true, // 不要求关键词位置接近
    });

    return fuse.search(keyword).map((result) => result.item);
  } catch (error) {
    console.error("模糊搜索出现错误：", error);
    return [];
  }
};

/**
 * 将 32 位 ARGB 颜色值转换为 24 位 RGB 颜色值
 *
 * @param {number} x - 32位ARGB颜色值
 * @returns {number[]} - 包含红色、绿色和蓝色分量的24位RGB颜色值数组（0-255）
 */
export const argbToRgb = (x: number): number[] => {
  // 提取红色、绿色和蓝色分量
  const r = (x >> 16) & 0xff;
  const g = (x >> 8) & 0xff;
  const b = x & 0xff;
  // 返回24位RGB颜色值数组
  return [r, g, b];
};

/**
 * 封面加载完成时，设置透明度为 1
 * @param e 事件对象
 */
export const coverLoaded = (e: Event) => {
  const target = e.target as HTMLElement | null;
  if (target && target.nodeType === Node.ELEMENT_NODE) {
    target.style.opacity = "1";
  }
};

/**
 * 格式化数字
 * @param num 要格式化的数字
 * @returns 格式化后的数字字符串
 */
export const formatNumber = (num: number): string => {
  if (num < 10000) {
    return num.toString();
  } else if (num < 100000000) {
    return `${(num / 10000).toFixed(1)}万`;
  } else {
    return `${(num / 100000000).toFixed(1)}亿`;
  }
};

/**
 * 格式化文件大小
 * @param bytes 文件大小（字节）
 * @returns 格式化后的文件大小字符串
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  } else {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
};
/**
 * 复制数据到剪贴板（原生实现）
 * @param text 要复制的数据
 * @param message 复制成功提示消息（可选）
 */
export const copyData = async (text: any, message?: string) => {
  if (!text) return;
  const content =
    typeof text === "string"
      ? text.trim()
      : Array.isArray(text)
        ? text.join("\n")
        : JSON.stringify(text, null, 2);
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(content);
      window.$message.success(message ?? "已复制到剪贴板");
      return;
    } catch (err) {
      console.error("clipboard.writeText 失败，尝试降级方案", err);
    }
  }
  // 降级方案
  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    // 避免页面滚动
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    // 添加到页面
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    // 执行复制
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (success) {
      window.$message.success(message ?? "已复制到剪贴板");
    } else {
      throw new Error("execCommand 返回 false");
    }
  } catch (error) {
    window.$message.error("复制出错，请重试");
    console.error("复制出错：", error);
  }
};

/*
 * 获取剪贴板内容
 * @returns 剪贴板内容字符串或 null
 */
export const getClipboardData = async (): Promise<string | null> => {
  try {
    const text = await navigator.clipboard.readText();
    return text;
  } catch (error) {
    console.error("Failed to read clipboard content:", error);
    return null;
  }
};

/**
 * 格式化为 Electron 快捷键
 * @param shortcut 快捷键
 * @returns Accelerator
 */
export const formatForGlobalShortcut = (shortcut: string): string => {
  return shortcut
    .split("+")
    .map((part) => {
      // 字母
      if (part.startsWith("Key")) {
        return part.replace("Key", "");
      }
      // 数字
      if (part.startsWith("Digit")) {
        return part.replace("Digit", "num");
      }
      if (part.startsWith("Numpad")) {
        return part.replace("Numpad", "num");
      }
      // 方向键
      if (part.startsWith("Arrow")) {
        return part.replace("Arrow", "");
      }
      return part;
    })
    .join("+");
};

/**
 * 获取更新日志
 * @returns 更新日志数组
 */
export const getUpdateLog = async (): Promise<UpdateLogType[]> => {
  const result = await getCacheData(updateLog, { key: "updateLog", time: 10 });
  if (!result || isEmpty(result)) return [];
  const updateLogs = await Promise.all(
    result.map(async (v: any) => ({
      version: v.tag_name,
      changelog: await marked(v.body),
      time: convertToLocalTime(v.published_at),
      url: v.html_url,
      prerelease: v.prerelease,
    })),
  );
  return updateLogs;
};

/**
 * 洗牌数组（Fisher-Yates）
 */
export const shuffleArray = <T>(arr: T[]): T[] => {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/**
 * 处理歌曲音质
 * @param song 歌曲数据
 * @param type 歌曲类型
 * @returns 歌曲音质
 */
export const handleSongQuality = (
  song: AnyObject | number,
  type: "local" | "online" = "local",
): QualityType | undefined => {
  const settingStore = useSettingStore();
  const { disableAiAudio } = settingStore;
  if (!song) return undefined;
  if (type === "local" && typeof song === "number") {
    if (song >= 960000) return QualityType.HiRes;
    if (song >= 441000) return QualityType.SQ;
    if (song >= 320000) return QualityType.HQ;
    if (song >= 160000) return QualityType.MQ;
    return QualityType.LQ;
  }

  const levelQualityMap = {
    jymaster: QualityType.Master,
    dolby: QualityType.Dolby,
    sky: QualityType.Spatial,
    jyeffect: QualityType.Surround,
    hires: QualityType.HiRes,
    lossless: QualityType.SQ,
    exhigh: QualityType.HQ,
    higher: QualityType.MQ,
    standard: QualityType.LQ,
  };

  // Fuck AI Filter: 如果是 AI 音质，跳过 level 属性判断，让后续遍历逻辑来确定真正的最高音质
  const isAiLevel =
    disableAiAudio &&
    typeof song === "object" &&
    song &&
    (("level" in song && AI_AUDIO_LEVELS.includes(song.level)) ||
      ("privilege" in song &&
        AI_AUDIO_LEVELS.includes(song.privilege?.playMaxBrLevel ?? song.privilege?.plLevel)));

  if (typeof song === "object" && song && !isAiLevel) {
    // 含有 level 特殊处理（仅在非 AI 音质时使用）
    if ("level" in song) {
      const quality = levelQualityMap[song.level];
      if (quality) return quality;
    }
    // 云盘歌曲适配
    if ("privilege" in song) {
      const privilege = song.privilege;
      const quality =
        levelQualityMap[privilege?.playMaxBrLevel] ?? levelQualityMap[privilege?.plLevel];
      if (quality) return quality;
    }
  }

  const order = [
    { key: "jm", type: QualityType.Master },
    { key: "db", type: QualityType.Dolby },
    { key: "sk", type: QualityType.Spatial },
    { key: "je", type: QualityType.Surround },
    { key: "hr", type: QualityType.HiRes },
    { key: "sq", type: QualityType.SQ },
    { key: "h", type: QualityType.HQ },
    { key: "m", type: QualityType.MQ },
    { key: "l", type: QualityType.LQ },
  ];

  for (const itemKey of order) {
    // 过滤 AI 音质
    if (disableAiAudio && AI_AUDIO_KEYS.includes(itemKey.key)) {
      continue;
    }
    if (song[itemKey.key] && Number(song[itemKey.key].br) > 0) {
      return itemKey.type;
    }
  }
  return undefined;
};

/**
 * 获取分享链接
 * @param type 资源类型 (song, playlist, album, artist, mv, etc.)
 * @param id 资源 ID
 * @returns 分享链接
 */
export const getShareUrl = (type: string, id: number | string): string => {
  const settingStore = useSettingStore();
  const { shareUrlFormat } = settingStore;

  if (shareUrlFormat === "mobile") {
    return `https://y.music.163.com/m/${type}?id=${id}`;
  }

  return `https://music.163.com/#/${type}?id=${id}`;
};

// 网易系域名（自带 CORS 头，可直连）
const NETEASE_HOST_RE = /(?:^|\.)music\.126\.net$|(?:^|\.)music\.163\.com$/;

// 第三方解锁音源域名白名单（与服务端代理白名单保持一致）
const UNLOCK_HOST_SUFFIXES = [
  "kuwo.cn",
  "kugou.com",
  "migu.cn",
  "miguvideo.com",
  "bilivideo.com",
  "bilibili.com",
  "gdstudio.xyz",
  "126.net",
  "163.com",
];

// 判断是否为白名单内的第三方音源
const isUnlockHost = (url: string): boolean => {
  try {
    const host = new URL(url).hostname;
    return UNLOCK_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
};

/**
 * 将第三方解锁音频地址改写为同源代理地址
 * 浏览器下跨源音频被 CORS 拦截（音频图需 crossorigin=anonymous），需经服务端转发
 * @param url 原始音频地址
 * @param force 是否强制代理（网易域名默认直连，下载场景可强制）
 * @returns 代理后的相对地址或原地址
 */
export const toProxiedUrl = (url: string | undefined | null, force = false): string => {
  if (!url) return "";
  if (!/^https?:\/\//.test(url)) return url;
  // 网易域名默认直连（自带 ACAO 头），第三方白名单域名走代理
  const needProxy = force || (isUnlockHost(url) && !NETEASE_HOST_RE.test(new URL(url).hostname));
  return needProxy ? `/api/unblock/proxy?url=${encodeURIComponent(url)}` : url;
};

// 音源显示名映射
export const AUDIO_SOURCE_LABELS: Record<string, string> = {
  official: "Official",
  netease: "Netease",
  kuwo: "Kuwo",
  bodian: "Bodian",
  local: "Local",
  streaming: "Streaming",
  kugou: "Kugou",
  migu: "Migu",
  bilibili: "Bilibili",
  pyncmd: "Pyncmd",
};

/**
 * 获取音源显示名
 * @param source 音源标识
 * @returns 显示名，未知音源转大写展示
 */
export const audioSourceLabel = (source?: string): string => {
  if (!source) return "";
  return AUDIO_SOURCE_LABELS[source] ?? source.toUpperCase();
};
