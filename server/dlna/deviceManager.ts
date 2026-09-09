// DLNA 设备缓存管理：周期自动刷新，自动跟踪电视服务端口变化
import { serverLog } from "../utils/logger";
import { discoverDlnaDevices, type DlnaDevice } from "./ssdp";

// 设备缓存（uuid → 设备信息，含 controlUrl）
const deviceCache = new Map<string, DlnaDevice>();

// 常驻刷新定时器与状态
let refreshTimer: NodeJS.Timeout | null = null;
let lastDiscoverAt = 0;
let discovering = false;

// 主动补扫间隔（毫秒）
const REFRESH_INTERVAL = 5 * 60 * 1000;
// 距上次发现不足该时间时跳过重复扫描（防前端频繁点击触发扫描风暴）
const MIN_DISCOVER_GAP = 5000;

/**
 * 将设备写入缓存
 */
const cacheDevices = (devices: DlnaDevice[]): void => {
  devices.forEach((device) => deviceCache.set(device.uuid, device));
  lastDiscoverAt = Date.now();
};

/**
 * 刷新设备列表（带并发与频率保护）
 * @param force 是否强制扫描（忽略频率限制）
 */
export const refreshDevices = async (force = false): Promise<DlnaDevice[]> => {
  if (!force && Date.now() - lastDiscoverAt < MIN_DISCOVER_GAP) {
    return [...deviceCache.values()];
  }
  if (discovering) return [...deviceCache.values()];
  discovering = true;
  try {
    const { devices } = await discoverDlnaDevices(3500);
    cacheDevices(devices);
    return devices;
  } finally {
    discovering = false;
  }
};

/**
 * 主动扫描并返回设备与诊断信息（discover 接口专用）
 */
export const discoverWithDebug = async (): Promise<{
  devices: DlnaDevice[];
  debug: unknown;
}> => {
  if (discovering) {
    return { devices: [...deviceCache.values()], debug: { note: "扫描进行中，返回缓存" } };
  }
  discovering = true;
  try {
    const result = await discoverDlnaDevices(3500);
    cacheDevices(result.devices);
    return result;
  } finally {
    discovering = false;
  }
};

/**
 * 按 uuid 获取设备；缓存未命中时补扫一次（如电视服务重启换端口后）
 */
export const getDevice = async (uuid: string): Promise<DlnaDevice | null> => {
  const cached = deviceCache.get(uuid);
  if (cached) return cached;
  await refreshDevices();
  return deviceCache.get(uuid) ?? null;
};

/**
 * 启动后台周期刷新（进程级单例），保持设备信息新鲜
 */
export const startDeviceWatcher = (): void => {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void refreshDevices(true);
  }, REFRESH_INTERVAL);
  serverLog.info("🔁 DLNA 设备自动刷新已启动（每 5 分钟）");
};

/**
 * 停止后台刷新（主要用于测试）
 */
export const stopDeviceWatcher = (): void => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};
