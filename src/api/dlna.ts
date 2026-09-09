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
}

/**
 * 扫描局域网 DLNA 渲染器设备
 */
export const dlnaDiscover = async (): Promise<DlnaDeviceInfo[]> => {
  const res = await request<{ code: number; data: DlnaDeviceInfo[] }>({
    baseURL: "/api",
    url: "/dlna/discover",
    method: "post",
    timeout: 10000,
  });
  return res?.data ?? [];
};

/**
 * 投送媒体到目标设备并播放
 * @param uuid 设备 id
 * @param url 媒体地址（相对地址可由服务端补全为绝对地址）
 * @param cover 封面地址（可选，传入时服务端合成封面视频流，电视全屏显示）
 */
export const dlnaPlay = async (uuid: string, url: string, cover?: string): Promise<void> => {
  await request<{ code: number; message?: string }>({
    baseURL: "/api",
    url: "/dlna/play",
    method: "post",
    data: cover ? { uuid, url, cover } : { uuid, url },
  });
};

/**
 * 控制渲染器播放
 * @param uuid 设备 id
 * @param action 指令：pause / resume / stop / seek
 * @param value seek 目标时间（秒）
 */
export const dlnaControl = async (
  uuid: string,
  action: "pause" | "resume" | "stop" | "seek",
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
 * 查询渲染器播放状态与进度
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
