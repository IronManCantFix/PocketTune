// DLNA 局域网投送 API：设备发现、投送、控制与状态查询
import request from "@/utils/request";

/**
 * DLNA 渲染器设备信息（发现接口返回）
 */
export interface DlnaDeviceInfo {
  /** 设备唯一标识 */
  uuid: string;
  /** 设备名称 */
  name: string;
  /** 设备类型 */
  deviceType: string;
}

/**
 * 渲染器播放状态
 */
export interface DlnaTransportState {
  /** 是否正在播放 */
  playing: boolean;
  /** 播放状态文本 */
  state: string;
  /** 当前播放进度（秒） */
  currentTime: number;
  /** 媒体总时长（秒） */
  duration: number;
  /** 当前音量（0-100，设备不支持时为 null） */
  volume: number | null;
  /** 是否静音（设备不支持时为 null） */
  muted: boolean | null;
}

/**
 * 投送任务状态（后端异步合成+投送，前端轮询确认）
 */
export interface DlnaTaskState {
  /** 任务状态：等待中 / 执行中 / 已完成 / 失败 / 已取消 */
  state: "pending" | "running" | "done" | "error" | "cancelled";
  /** 失败原因或提示信息 */
  message?: string;
}

/**
 * 扫描局域网 DLNA 渲染器设备
 */
export const dlnaDiscover = async (): Promise<DlnaDeviceInfo[]> => {
  const res = await request<{ code: number; data: DlnaDeviceInfo[] }>({
    baseURL: "/api",
    url: "/dlna/discover",
    method: "post",
    // SSDP 收集 3.5s + 设备描述解析，留足余量避免慢设备超时
    timeout: 15000,
  });
  return res?.data ?? [];
};

/**
 * 歌词行（投送合成字幕用）
 */
export interface DlnaLyricLine {
  /** 行起始时间（毫秒） */
  startTime: number;
  /** 行结束时间（毫秒） */
  endTime: number;
  /** 行文本 */
  words: string;
  /** 翻译（可选） */
  translatedLyric?: string;
}

/**
 * 投送前连通性探测：验证设备 SOAP 控制链路真实可达
 * 服务端含端口漂移自愈（失效时自动重扫重试）
 * @param uuid 设备 id
 * @returns 是否可达
 */
export const dlnaProbe = async (uuid: string): Promise<boolean> => {
  const res = await request<{ code: number; data?: { reachable: boolean } }>({
    baseURL: "/api",
    url: "/dlna/probe",
    method: "post",
    data: { uuid },
    // 含自动重扫（3.5s）与两次 SOAP 探测的余量
    timeout: 20000,
  });
  return res?.data?.reachable ?? false;
};

/**
 * 投送媒体到目标设备并播放（后端异步执行，返回任务 id 供轮询确认）
 * @param uuid 设备 id
 * @param url 媒体地址（相对地址可由服务端补全为绝对地址）
 * @param cover 封面地址（可选，传入时服务端合成封面视频流，电视全屏显示）
 * @param options 附加元数据：歌词与歌名/歌手（封面视频模式烧录字幕用）、songId（服务端缓存 key）
 * @returns 投送任务 id（0 表示旧后端直接成功）
 */
export const dlnaPlay = async (
  uuid: string,
  url: string,
  cover?: string,
  options?: { title?: string; artist?: string; lyrics?: DlnaLyricLine[]; songId?: number },
): Promise<number> => {
  const data: Record<string, unknown> = { uuid, url };
  if (cover) data.cover = cover;
  if (options?.title) data.title = options.title;
  if (options?.artist) data.artist = options.artist;
  if (options?.lyrics?.length) data.lyrics = options.lyrics;
  // 传歌曲 id 供服务端稳定缓存 key
  if (options?.songId != null) data.songId = options.songId;
  const res = await request<{ code: number; data?: { taskId: number }; message?: string }>({
    baseURL: "/api",
    url: "/dlna/play",
    method: "post",
    data,
  });
  return res?.data?.taskId ?? 0;
};

/**
 * 查询投送任务状态
 * @param taskId 投送任务 id
 * @returns 任务状态，任务不存在（已被清理）时返回 null
 */
export const dlnaTaskStatus = async (taskId: number): Promise<DlnaTaskState | null> => {
  const res = await request<{ code: number; data?: DlnaTaskState | null }>({
    baseURL: "/api",
    url: "/dlna/task",
    method: "get",
    params: { id: taskId },
  });
  return res?.data ?? null;
};

/**
 * 取消投送任务（仅 pending 状态可取消，幂等）
 * @param taskId 投送任务 id
 */
export const dlnaTaskCancel = async (taskId: number): Promise<void> => {
  await request<{ code: number }>({
    baseURL: "/api",
    url: "/dlna/task/cancel",
    method: "post",
    data: { id: taskId },
  });
};

/**
 * 控制渲染器播放
 * @param uuid 设备 id
 * @param action 指令：pause / resume / stop / seek / volume / mute
 * @param value seek 目标时间（秒）、volume 音量（0-100）、mute 静音标记（0/1）
 */
export const dlnaControl = async (
  uuid: string,
  action: "pause" | "resume" | "stop" | "seek" | "volume" | "mute",
  value?: number,
): Promise<void> => {
  await request<{ code: number; message?: string }>({
    baseURL: "/api",
    url: "/dlna/control",
    method: "post",
    data: { uuid, action, value },
  });
};

/**
 * 查询渲染器播放状态与进度（含音量/静音）
 */
export const dlnaStatus = async (uuid: string): Promise<DlnaTransportState | null> => {
  const res = await request<{ code: number; data: DlnaTransportState }>({
    baseURL: "/api",
    url: "/dlna/status",
    method: "get",
    params: { uuid },
  });
  return res?.data ?? null;
};
