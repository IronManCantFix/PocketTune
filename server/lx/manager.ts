// 洛雪源脚本管理：持久化、加载缓存、按优先级解析播放地址
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { serverLog } from "../utils/logger";
import { ensureDataDir } from "../utils/paths";
import { callMusicUrl, extractMeta, loadLxScript } from "./runtime";
import type { LxApiInstance, LxMusicUrlResult, LxScriptRecord } from "./types";

/** 脚本元数据文件名 */
const META_FILE = "sources.json";
/** 单个脚本大小上限，防止导入超大文件 */
const MAX_SCRIPT_SIZE = 2 * 1024 * 1024;
/** 脚本数量上限 */
const MAX_SCRIPT_COUNT = 30;

/** 已加载的脚本实例缓存（id → 实例） */
const loadedInstances = new Map<string, LxApiInstance>();
/** 脚本加载错误缓存（id → 错误信息） */
const loadErrors = new Map<string, string>();

/** 获取脚本目录 */
const scriptDir = (): string => ensureDataDir("lx");

/** 获取元数据文件路径 */
const metaPath = (): string => join(scriptDir(), META_FILE);

/**
 * 读取脚本记录列表，按文件内顺序即优先级顺序
 * 文件不存在或损坏时返回空列表
 */
export const readRecords = (): LxScriptRecord[] => {
  const path = metaPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is LxScriptRecord => {
      const record = item as LxScriptRecord;
      return !!record && typeof record.id === "string";
    });
  } catch (error) {
    serverLog.error("❌ 洛雪源元数据读取失败:", error);
    return [];
  }
};

/** 写入脚本记录列表 */
const writeRecords = (records: LxScriptRecord[]): void => {
  try {
    writeFileSync(metaPath(), JSON.stringify(records, null, 2), "utf8");
  } catch (error) {
    serverLog.error("❌ 洛雪源元数据写入失败:", error);
  }
};

/** 根据源名称生成可读且唯一的文件名 */
const generateId = (name: string, script: string): string => {
  // 仅保留中英文数字与连字符，避免路径穿越与非法字符
  const base = (name || "source").replace(/[^\w\u4e00-\u9fa5-]/g, "").slice(0, 40);
  const hash = createHash("sha1").update(script).digest("hex").slice(0, 8);
  return `${base || "source"}-${hash}.js`;
};

/** 脚本文件绝对路径 */
const scriptPath = (id: string): string => join(scriptDir(), id);

/**
 * 加载单个脚本并写入实例缓存
 * @param record 脚本记录
 */
const loadRecord = async (record: LxScriptRecord): Promise<void> => {
  const path = scriptPath(record.id);
  if (!existsSync(path)) {
    loadErrors.set(record.id, "脚本文件不存在");
    record.error = "脚本文件不存在";
    return;
  }
  try {
    const script = readFileSync(path, "utf8");
    const result = await loadLxScript(script, record.id);
    if (result.success) {
      loadedInstances.set(record.id, result.instance);
      loadErrors.delete(record.id);
      record.platforms = Object.keys(result.instance.sources);
      // 以脚本实际声明的元数据为准回填
      record.meta = result.instance.meta;
      delete record.error;
    } else {
      loadedInstances.delete(record.id);
      loadErrors.set(record.id, result.error);
      record.error = result.error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadedInstances.delete(record.id);
    loadErrors.set(record.id, message);
    record.error = message;
  }
};

/**
 * 启动时加载全部已启用脚本
 * 同步执行以便服务就绪后立即可用
 */
export const initLxSources = async (): Promise<void> => {
  const records = readRecords();
  if (records.length === 0) return;
  const enabled = records.filter((record) => record.enabled);
  serverLog.info(`🎵 开始加载洛雪源脚本，共 ${records.length} 个，启用 ${enabled.length} 个`);
  for (const record of enabled) {
    await loadRecord(record);
  }
  writeRecords(records);
  serverLog.info(`🎵 洛雪源加载完成：成功 ${loadedInstances.size} 个，失败 ${loadErrors.size} 个`);
};

/**
 * 导入脚本
 * @param script 脚本源码
 * @returns 导入结果，含脚本 id
 */
export const importScript = async (
  script: string,
): Promise<{ success: boolean; id?: string; error?: string }> => {
  if (typeof script !== "string" || script.trim().length === 0) {
    return { success: false, error: "脚本内容为空" };
  }
  if (Buffer.byteLength(script, "utf8") > MAX_SCRIPT_SIZE) {
    return { success: false, error: "脚本体积超过 2MB 限制" };
  }
  const records = readRecords();
  if (records.length >= MAX_SCRIPT_COUNT) {
    return { success: false, error: `脚本数量已达上限（${MAX_SCRIPT_COUNT} 个）` };
  }
  // 先试加载，未注册任何平台的脚本直接拒绝入库
  const meta = extractMeta(script);
  const id = generateId(meta.name, script);
  if (records.some((record) => record.id === id)) {
    return { success: false, error: `脚本「${meta.name || id}」已存在` };
  }
  const probe = await loadLxScript(script, id);
  if (!probe.success) {
    return { success: false, error: probe.error };
  }
  try {
    writeFileSync(scriptPath(id), script, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `脚本写入失败: ${message}` };
  }
  const record: LxScriptRecord = {
    id,
    meta: probe.instance.meta,
    size: Buffer.byteLength(script, "utf8"),
    // 默认不启用，避免用户导入即生效
    enabled: false,
    createdAt: new Date().toISOString(),
    platforms: Object.keys(probe.instance.sources),
  };
  records.push(record);
  writeRecords(records);
  // 导入后立即进入缓存，启用时无需重新加载
  loadedInstances.set(id, probe.instance);
  serverLog.info(`🎵 洛雪源导入成功: ${record.meta.name || id}`);
  return { success: true, id };
};

/**
 * 删除脚本
 * @param id 脚本 id
 */
export const deleteScript = (id: string): boolean => {
  const records = readRecords();
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) return false;
  try {
    const path = scriptPath(id);
    if (existsSync(path)) unlinkSync(path);
  } catch (error) {
    serverLog.error("❌ 洛雪源脚本删除失败:", error);
  }
  records.splice(index, 1);
  writeRecords(records);
  loadedInstances.delete(id);
  loadErrors.delete(id);
  serverLog.info(`🎵 洛雪源已删除: ${id}`);
  return true;
};

/**
 * 启用或禁用脚本
 * @param id 脚本 id
 * @param enabled 是否启用
 */
export const toggleScript = async (id: string, enabled: boolean): Promise<boolean> => {
  const records = readRecords();
  const record = records.find((item) => item.id === id);
  if (!record) return false;
  record.enabled = enabled;
  if (enabled && !loadedInstances.has(id)) {
    await loadRecord(record);
  }
  if (!enabled) {
    // 禁用后释放沙箱实例
    loadedInstances.delete(id);
  }
  writeRecords(records);
  return true;
};

/**
 * 调整脚本优先级
 * @param ids 按新顺序排列的脚本 id 列表
 */
export const reorderScripts = (ids: string[]): boolean => {
  const records = readRecords();
  if (ids.length !== records.length) return false;
  const map = new Map(records.map((record) => [record.id, record]));
  const sorted: LxScriptRecord[] = [];
  for (const id of ids) {
    const record = map.get(id);
    if (!record) return false;
    sorted.push(record);
  }
  writeRecords(sorted);
  return true;
};

/**
 * 获取脚本列表用于前端展示，附带运行时状态
 */
export const listScripts = (): (LxScriptRecord & { loaded: boolean; runtimeError?: string })[] => {
  return readRecords().map((record) => ({
    ...record,
    loaded: loadedInstances.has(record.id),
    runtimeError: loadErrors.get(record.id),
  }));
};

/** 是否存在已启用且加载成功的脚本 */
export const hasAvailableSource = (): boolean => loadedInstances.size > 0;

/**
 * 收集当前生效的脚本实例，按记录顺序即优先级
 */
const getActiveInstances = (): LxApiInstance[] => {
  const records = readRecords();
  const result: LxApiInstance[] = [];
  for (const record of records) {
    if (!record.enabled) continue;
    const instance = loadedInstances.get(record.id);
    if (instance) result.push(instance);
  }
  return result;
};

/**
 * 依次尝试各脚本解析播放地址，命中即返回
 * 单个脚本失败不影响后续脚本
 * @param songmid 网易云歌曲 id
 * @param quality 音质（128k / 320k / flac / flac24bit）
 * @param songName 歌名
 * @param artist 歌手
 */
export const resolveMusicUrl = async (
  songmid: string,
  quality: string,
  songName: string,
  artist: string,
): Promise<LxMusicUrlResult> => {
  const instances = getActiveInstances();
  if (instances.length === 0) {
    return { code: 404, url: null };
  }
  // 仅传 wy 平台：PocketTune 只有网易云 id，其它平台无有效 songmid
  const musicInfo = {
    songmid,
    id: songmid,
    name: songName,
    singer: artist,
    source: "wy",
  };
  for (const instance of instances) {
    try {
      const url = await callMusicUrl(instance, "wy", quality, musicInfo);
      serverLog.log(`🎵 洛雪源命中: ${instance.meta.name || instance.id} → ${url.slice(0, 80)}`);
      return { code: 200, url, source: instance.meta.name || instance.id, sourceId: instance.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      serverLog.debug(`🎵 洛雪源 ${instance.meta.name || instance.id} 解析失败:`, message);
    }
  }
  return { code: 404, url: null };
};

/** 状态摘要，供健康检查与设置页展示 */
export const getStatus = (): { total: number; enabled: number; loaded: number } => {
  const records = readRecords();
  return {
    total: records.length,
    enabled: records.filter((record) => record.enabled).length,
    loaded: loadedInstances.size,
  };
};
