// UnblockNeteaseMusic 集成，负责解灰匹配与歌 URL 类响应改写
import match from "@unblockneteasemusic/server";
import type { UnmAudioData } from "@unblockneteasemusic/server";
import { serverLog } from "../utils/logger";
import { getStoreValue, setStoreValue } from "../netease/config-store";

// 默认音源列表
const DEFAULT_SOURCES = ["kugou", "kuwo", "bilibili", "pyncmd"];

// 暴露默认顺序给 sources 接口展示
export const getDefaultSources = (): string[] => [...DEFAULT_SOURCES];

// 默认最低码率
const DEFAULT_MIN_BR = 128000;

// 需要解灰后处理的歌 URL 类路由（enhanced 包实际导出的函数名）
const SONG_URL_ROUTES = new Set([
  "song_url",
  "song_url_v1",
  "song_url_v1_302",
  "song_download_url",
  "song_download_url_v1",
]);

// 是否启用解灰
export const isUnmEnabled = (): boolean => process.env["UNM_ENABLED"] !== "false";

// 是否为歌 URL 类路由
export const isSongUrlRoute = (routerName: string): boolean => SONG_URL_ROUTES.has(routerName);

// 可用音源白名单
const KNOWN_SOURCES = ["kugou", "kuwo", "migu", "bilibili", "pyncmd"];

// 清洗音源列表：仅保留白名单内音源并去重
const sanitizeSources = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((s): s is string => typeof s === "string" && KNOWN_SOURCES.includes(s)),
    ),
  ];
};

// 运行时音源设置（前端设置页写入，null 表示未自定义）
export const getCustomSources = (): string[] | null => {
  const value = getStoreValue<unknown>("unblockSources", null);
  const sources = sanitizeSources(value);
  return sources.length > 0 ? sources : null;
};

// 写入运行时音源设置，空列表表示清除自定义、恢复默认
export const setCustomSources = (sources: string[]): void => {
  const cleaned = sanitizeSources(sources);
  setStoreValue("unblockSources", cleaned.length > 0 ? cleaned : null);
};

// 获取生效音源列表：运行时设置 > 环境变量 > 默认顺序
export const getSources = (): string[] => {
  const custom = getCustomSources();
  if (custom) return custom;
  const raw = process.env["UNBLOCK_SOURCES"]?.trim();
  if (raw) {
    const sources = sanitizeSources(raw.split(/\s+/));
    if (sources.length > 0) return sources;
  }
  return DEFAULT_SOURCES;
};

// 解析最低码率
const getMinBr = (): number => Number(process.env["MIN_BR"]) || DEFAULT_MIN_BR;

// 调用 UNM 匹配，失败吞掉异常返回 null
const matchSong = async (id: number | string): Promise<UnmAudioData | null> => {
  try {
    // 显式传音源数组，避免依赖 global.source 副作用
    return await match(id, getSources());
  } catch (error) {
    // SongNotAvailable / RequestFailed / IncompleteAudioData / RequestCancelled 等一律吞掉
    serverLog.debug("🎵 UNM match 失败:", error instanceof Error ? error.message : error);
    return null;
  }
};

// 判断单项是否需要解灰，复刻 UNM hook.js 判定
const needReplace = (item: Record<string, unknown>): boolean => {
  const minBr = getMinBr();
  const freeTrialInfo = item["freeTrialInfo"];
  // enhanced 包 song_url_v1 的 unblock 路径会返回字符串 'null'，视为无试听
  const hasFreeTrial = freeTrialInfo != null && freeTrialInfo !== "null";
  const br = item["br"];
  return item["code"] !== 200 || hasFreeTrial || (typeof br === "number" && br < minBr);
};

// 改写单个响应项
const replaceItem = async (item: Record<string, unknown>): Promise<void> => {
  const song = await matchSong(item["id"] as number | string);
  // 匹配失败保持原响应
  if (!song || typeof song.url !== "string") return;
  item["type"] = song.br === 999000 ? "flac" : "mp3";
  item["url"] = song.url;
  item["md5"] = song.md5 ?? item["md5"] ?? null;
  item["br"] = song.br || 128000;
  item["size"] = song.size;
  item["code"] = 200;
  item["freeTrialInfo"] = null;
  // 标记实际音源，供前端展示
  item["unmSource"] = song.source;
  serverLog.log(`🎵 UNM 替换歌曲 ${String(item["id"])} 成功，音源: ${song.source}`);
};

/**
 * 对歌 URL 类响应体做解灰改写
 * 兼容 data 为数组、单对象、空与字符串（如 302 重定向）的形态
 */
export const rewriteSongUrlBody = async (body: unknown): Promise<void> => {
  if (!isUnmEnabled()) return;
  if (!body || typeof body !== "object") return;
  const { data } = body as { data?: unknown };
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    // 跳过无 id 的项（重定向、字符串 data 等）
    if (!item || typeof item !== "object" || (item as Record<string, unknown>)["id"] == null) {
      continue;
    }
    const target = item as Record<string, unknown>;
    if (!needReplace(target)) continue;
    await replaceItem(target);
  }
};
