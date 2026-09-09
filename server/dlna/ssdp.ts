// SSDP 设备发现：主动 M-SEARCH 搜索 + 被动 NOTIFY 监听，收集 DLNA 渲染器设备
import dgram from "node:dgram";
import os from "node:os";
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
 * 选取本机内网 IPv4 地址列表（用于指定组播出接口）
 * 按优先级排序：192.168 > 10.x > 172.16-31（Docker 网段排最后，避免误选 docker0/容器桥）
 * 可通过环境变量 DLNA_INTERFACE 强制指定接口 IP
 */
const listLanIPv4s = (): string[] => {
  // 环境变量强制指定（如 NAS 多网卡场景）
  const manual = process.env.DLNA_INTERFACE?.trim();
  if (manual) return [manual];

  const candidates: Record<"high" | "mid" | "low", string[]> = {
    high: [], // 192.168.x（家庭网段）
    mid: [], // 10.x
    low: [], // 172.16-31.x（含 Docker 默认网桥，最后尝试）
  };
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;
    for (const addr of addresses) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const ip = addr.address;
      if (/^192\.168\./.test(ip)) {
        candidates.high.push(ip);
      } else if (/^10\./.test(ip)) {
        candidates.mid.push(ip);
      } else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
        candidates.low.push(ip);
      }
    }
  }
  return [...candidates.high, ...candidates.mid, ...candidates.low];
};

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
 * 遍历所有 service 节点，定位 AVTransport 服务的控制地址
 */
const findAvtransportService = (deviceXml: string): { controlPath: string; eventPath: string } => {
  const regex = /<[a-zA-Z0-9]*:?service>([\s\S]*?)<\/[a-zA-Z0-9]*:?service>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(deviceXml)) !== null) {
    if (extractTag(match[1], "serviceType").includes("AVTransport")) {
      return {
        controlPath: extractTag(match[1], "controlURL"),
        eventPath: extractTag(match[1], "eventSubURL"),
      };
    }
  }
  return { controlPath: "", eventPath: "" };
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
    if (!deviceXml) return null;

    const deviceType = extractTag(deviceXml, "deviceType");
    const uuid = extractTag(deviceXml, "UDN").replace(/^uuid:/, "");
    const name = extractTag(deviceXml, "friendlyName");

    // 定位 AVTransport 服务（负责媒体播放控制）
    const { controlPath, eventPath } = findAvtransportService(deviceXml);
    if (!controlPath) return null;

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
 * 发现过程诊断信息（用于远程排查）
 */
export interface DlnaDiscoveryDebug {
  /** 容器内可见的非回环 IPv4 接口（名称与地址） */
  interfaces: { name: string; ip: string }[];
  /** 实际使用的组播出接口 */
  usedInterfaces: string[];
  /** 绑定的本地端口 */
  boundPort: number;
  /** 收到的 SSDP 报文总数 */
  packetCount: number;
  /** 其中 M-SEARCH 响应数 */
  responseCount: number;
  /** 其中 NOTIFY 通告数 */
  notifyCount: number;
  /** 收到的报文样本（前 10 条，含来源与 LOCATION） */
  packets: string[];
  /** 看到过的设备描述地址 */
  locationsSeen: string[];
  /** 解析成功的设备数 */
  parsedCount: number;
  /** 发送与解析过程中的错误 */
  errors: string[];
}

/**
 * 扫描局域网 DLNA 渲染器设备
 * 绑定 1900 端口监听 NOTIFY 通告，并发送 M-SEARCH 主动搜索
 * 兼容单播/组播响应与主动通告两种发现方式
 * @param timeout 收集时长（毫秒）
 * @returns 发现的设备列表与诊断信息
 */
export const discoverDlnaDevices = async (
  timeout = 3500,
): Promise<{ devices: DlnaDevice[]; debug: DlnaDiscoveryDebug }> => {
  // 候选组播出接口：host 模式取 NAS 真实网卡，bridge 模式含容器网桥地址
  const lanIPs = listLanIPv4s();
  // 全部非回环 IPv4 接口（诊断用）
  const allInterfaces: { name: string; ip: string }[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        allInterfaces.push({ name, ip: addr.address });
      }
    }
  }

  // reuseAddr 允许与其他 UPnP 服务共存绑定 1900 端口
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const devices = new Map<string, DlnaDevice>();
  // 待解析与已解析的设备描述地址
  const pending = new Set<string>();
  const locations = new Set<string>();

  // 诊断数据收集
  const debug: DlnaDiscoveryDebug = {
    interfaces: allInterfaces,
    usedInterfaces: lanIPs,
    boundPort: 0,
    packetCount: 0,
    responseCount: 0,
    notifyCount: 0,
    packets: [],
    locationsSeen: [],
    parsedCount: 0,
    errors: [],
  };

  // 解析收集到的设备描述地址
  const resolveDevice = async (location: string): Promise<void> => {
    if (locations.has(location) || pending.has(location)) return;
    locations.add(location);
    debug.locationsSeen = [...locations];
    pending.add(location);
    const device = await parseDeviceDescription(location);
    pending.delete(location);
    if (device) {
      devices.set(device.uuid, device);
      debug.parsedCount = devices.size;
      serverLog.info(`✅ 发现渲染器: ${device.name} (${device.location})`);
    }
  };

  // 处理收到的 SSDP 报文：响应与 NOTIFY 均提取 LOCATION
  socket.on("message", (msg, rinfo) => {
    debug.packetCount += 1;
    const text = msg.toString("utf8");
    const isResponse = text.startsWith("HTTP/1.1 200");
    if (isResponse) {
      debug.responseCount += 1;
    } else if (text.startsWith("NOTIFY")) {
      debug.notifyCount += 1;
    }
    // 忽略离线通告
    if (/^NTS:\s*ssdp:byebye/im.test(text)) return;
    const location = text.match(/^LOCATION:\s*(.+)$/im)?.[1]?.trim();
    // 记录前 10 条报文样本供诊断
    if (debug.packets.length < 10) {
      debug.packets.push(
        `${rinfo.address}:${rinfo.port} | ${isResponse ? "RESPONSE" : "NOTIFY"} | ${location ?? "无LOCATION"}`,
      );
    }
    if (!location) return;
    void resolveDevice(location);
  });

  let boundPort = 0;
  try {
    // 优先绑定 1900 端口以接收组播 NOTIFY；被占用时降级随机端口（仍可收单播响应）
    await new Promise<void>((resolve) => {
      const onError = (): void => {
        socket.removeAllListeners("error");
        socket.removeAllListeners("listening");
        socket.bind(0, () => resolve());
      };
      socket.once("error", onError);
      socket.once("listening", () => {
        socket.removeListener("error", onError);
        resolve();
      });
      socket.bind(SSDP_PORT);
    });
    boundPort = socket.address().port;
    debug.boundPort = boundPort;

    // 加入组播组并逐接口配置，覆盖 NAS 多网卡场景
    if (lanIPs.length > 0) {
      for (const ip of lanIPs) {
        try {
          socket.addMembership(SSDP_ADDR, ip);
        } catch (error) {
          const msg = `接口 ${ip} 加入组播组失败: ${error instanceof Error ? error.message : error}`;
          debug.errors.push(msg);
          serverLog.warn(`⚠️ ${msg}`);
        }
      }
      try {
        socket.setMulticastTTL(4);
      } catch {
        // 部分环境不支持时忽略
      }
    } else {
      debug.errors.push("未检测到可用的内网 IPv4 接口");
    }

    // 构造 M-SEARCH 报文（逐接口发送，确保覆盖真实局域网口）
    const buildMSearch = (st: string): string =>
      [
        "M-SEARCH * HTTP/1.1",
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        "MX: 2",
        `ST: ${st}`,
        "", // 空行结尾
      ].join("\r\n");

    const sendTargets = lanIPs.length > 0 ? lanIPs : [""];

    // 对每个候选接口发送 M-SEARCH：MediaRenderer 精确搜索 + ssdp:all 全量搜索
    const sendSearch = (st: string): void => {
      for (const ip of sendTargets) {
        // 逐个指定出接口后发送；发送为同步进内核，顺序切换安全
        try {
          if (ip) socket.setMulticastInterface(ip);
        } catch (error) {
          const msg = `接口 ${ip} 设置组播出接口失败: ${error instanceof Error ? error.message : error}`;
          debug.errors.push(msg);
          serverLog.warn(`⚠️ ${msg}`);
          continue;
        }
        socket.send(buildMSearch(st), SSDP_PORT, SSDP_ADDR, (error) => {
          if (error) {
            const msg = `SSDP 发送失败 (接口 ${ip || "默认"}, ${st}): ${error.message}`;
            debug.errors.push(msg);
            serverLog.warn(`⚠️ ${msg}`);
          }
        });
      }
    };
    sendSearch(SEARCH_TARGET);
    setTimeout(() => sendSearch("ssdp:all"), 300);

    // 收集设备信息直至超时
    await new Promise<void>((resolve) => setTimeout(resolve, timeout));

    serverLog.info(
      `📡 SSDP 发现完成（端口 ${boundPort}，接口 ${lanIPs.join(" / ") || "默认"}），收包 ${debug.packetCount}（响应 ${debug.responseCount}/通告 ${debug.notifyCount}），设备 ${devices.size} 台`,
    );
    return { devices: [...devices.values()], debug };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`发现流程异常: ${msg}`);
    serverLog.error("❌ SSDP 发现失败:", msg);
    return { devices: [...devices.values()], debug };
  } finally {
    try {
      socket.close();
    } catch {
      // 忽略关闭异常
    }
  }
};
