// SSDP 设备发现：向局域网组播 M-SEARCH，收集 DLNA 渲染器设备信息
import dgram from "node:dgram";
import axios from "axios";
import { serverLog } from "../utils/logger";

// SSDP 组播地址与端口
const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;

// 搜索目标：标准媒体渲染器
const SEARCH_TARGET = "urn:schemas-upnp-org:device:MediaRenderer:1";

/**
 * DLNA 渲染器设备信息
 */
export interface DlnaDevice {
  /** 设备唯一标识 */
  uuid: string;
  /** 设备名称 */
  name: string;
  /** 设备描述 XML 地址 */
  location: string;
  /** 设备类型（通常为 MediaRenderer） */
  deviceType: string;
  /** 渲染器控制地址 */
  controlUrl: string;
  /** 事件订阅地址 */
  eventSubUrl: string;
}

/**
 * 提取标签文本值，兼容命名空间前缀（如 u:、upnp: 等）
 */
const extractTag = (xml: string, tag: string): string =>
  new RegExp(`<[a-zA-Z0-9]*:?${tag}>([^<]*)</[a-zA-Z0-9]*:?${tag}>`).exec(xml)?.[1]?.trim() ?? "";

/**
 * 合并相对 URL 与绝对 URL
 */
const resolveUrl = (base: string, path: string): string => {
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
};

/**
 * 逐个匹配所有 device 节点（非贪婪，兼容嵌套结构）
 */
const matchDeviceBlocks = (xml: string): string[] => {
  const blocks: string[] = [];
  const regex = /<[a-zA-Z0-9]*:?device>([\s\S]*?)<\/[a-zA-Z0-9]*:?device>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
};

/**
 * 从 deviceDesc.xml 中提取渲染器设备信息
 * 支持根级与 embedded 嵌套设备结构
 */
const parseDeviceDescription = async (location: string): Promise<DlnaDevice | null> => {
  try {
    const res = await axios.get<string>(location, { timeout: 5000 });
    const xml = res.data;

    // 定位首个 MediaRenderer 设备节点（可能嵌套在 MediaServer 下）
    const deviceBlocks = matchDeviceBlocks(xml);
    let deviceXml = "";
    for (const block of deviceBlocks) {
      if (extractTag(block, "deviceType").includes("MediaRenderer")) {
        deviceXml = block;
        break;
      }
    }
    // 根设备本身即为渲染器时，直接使用根级 device 块
    if (!deviceXml) {
      const rootBlock = deviceBlocks.find((block) => extractTag(block, "UDN"));
      if (rootBlock && extractTag(rootBlock, "deviceType").includes("MediaRenderer")) {
        deviceXml = rootBlock;
      }
    }
    if (!deviceXml) return null;

    const deviceType = extractTag(deviceXml, "deviceType");
    const uuid = extractTag(deviceXml, "UDN").replace(/^uuid:/, "");
    const name = extractTag(deviceXml, "friendlyName");

    // 定位 AVTransport 服务（负责媒体播放控制）
    const serviceMatch = /<[a-zA-Z0-9]*:?service>([\s\S]*?)<\/[a-zA-Z0-9]*:?service>/g.exec(
      deviceXml,
    );
    const serviceXml = serviceMatch?.[1] ?? "";
    const serviceType = extractTag(serviceXml, "serviceType");
    if (!serviceType.includes("AVTransport")) return null;
    const controlPath = extractTag(serviceXml, "controlURL");
    const eventPath = extractTag(serviceXml, "eventSubURL");

    return {
      uuid: uuid || location,
      name: name || "未知设备",
      location,
      deviceType,
      controlUrl: resolveUrl(location, controlPath),
      eventSubUrl: resolveUrl(location, eventPath),
    };
  } catch (error) {
    serverLog.warn(
      "⚠️ 解析设备描述失败:",
      location,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/**
 * 扫描局域网 DLNA 渲染器设备
 * 发送 SSDP M-SEARCH 组播，等待响应，解析设备描述
 * @param timeout 收集时长（毫秒）
 * @returns 发现的设备列表
 */
export const discoverDlnaDevices = async (timeout = 3000): Promise<DlnaDevice[]> => {
  const socket = dgram.createSocket("udp4");
  const devices = new Map<string, DlnaDevice>();
  const locations = new Set<string>();

  const message = [
    "M-SEARCH * HTTP/1.1",
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    "MX: 2",
    `ST: ${SEARCH_TARGET}`,
    "", // 空行结尾
  ].join("\r\n");

  try {
    await new Promise<void>((resolve, reject) => {
      socket.on("error", (error) => {
        serverLog.error("❌ SSDP 套接字错误:", error);
        reject(error);
      });

      // 监听组播响应
      socket.on("message", async (msg) => {
        const response = msg.toString("utf8");
        const location = response.match(/^LOCATION:\s*(.+)$/im)?.[1]?.trim();
        if (!location || locations.has(location)) return;
        locations.add(location);
        const device = await parseDeviceDescription(location);
        if (device) devices.set(device.uuid, device);
      });

      // 加入组播组并发送搜索请求
      socket.bind(() => {
        try {
          socket.addMembership(SSDP_ADDR);
          socket.setMulticastTTL(4);
          socket.send(message, SSDP_PORT, SSDP_ADDR, (error) => {
            if (error) {
              serverLog.error("❌ SSDP 发送失败:", error);
              reject(error);
            }
          });
        } catch (error) {
          serverLog.error("❌ SSDP 加入组播组失败:", error);
          reject(error);
        }
      });

      // 超时后结束收集
      setTimeout(resolve, timeout);
    });

    serverLog.info(`📡 SSDP 发现完成，共 ${devices.size} 台渲染器`);
    return [...devices.values()];
  } catch (error) {
    serverLog.error("❌ SSDP 发现失败:", error instanceof Error ? error.message : error);
    return [];
  } finally {
    try {
      socket.close();
    } catch {
      // 忽略关闭异常
    }
  }
};
