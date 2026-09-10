// AVTransport 服务 SOAP 控制：向 DLNA 渲染器发送播放控制指令
import axios, { type AxiosResponse } from "axios";
import { serverLog } from "../utils/logger";
import type { DlnaDevice } from "./ssdp";

/**
 * 渲染器当前播放状态
 */
export interface DlnaTransportState {
  /** 是否正在播放 */
  playing: boolean;
  /** 播放状态文本（PLAYING/PAUSED_PLAYBACK/STOPPED 等） */
  state: string;
  /** 当前播放进度（秒） */
  currentTime: number;
  /** 媒体总时长（秒） */
  duration: number;
  /** 当前音量（0-100，RenderingControl 查询失败时为 null） */
  volume: number | null;
  /** 是否静音（RenderingControl 查询失败时为 null） */
  muted: boolean | null;
}

// SOAP 响应中的常见命名空间前缀（s: / u:）
const extractSoapValue = (xml: string, tag: string): string => {
  const regex = new RegExp(`<[a-zA-Z0-9]*:?${tag}>([^<]*)</[a-zA-Z0-9]*:?${tag}>`);
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? "";
};

/**
 * 解析 UPnP 时间格式（H+:MM:SS）为秒
 */
const parseUpnpTime = (value: string): number => {
  if (!value || value === "0:00:00" || value === "NOT_IMPLEMENTED") return 0;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
};

// DLNA 控制服务类型：AVTransport（播放控制）/ RenderingControl（音量控制）
type DlnaService = "AVTransport" | "RenderingControl";

// 服务类型对应的 URN（SOAPAction 与 Body 命名空间）
const SOAP_SERVICE_URN: Record<DlnaService, string> = {
  AVTransport: "urn:schemas-upnp-org:service:AVTransport:1",
  RenderingControl: "urn:schemas-upnp-org:service:RenderingControl:1",
};

/**
 * 发送 SOAP 指令到渲染器指定服务
 * @param device 目标设备
 * @param action SOAP 动作名
 * @param args 动作参数（{ 参数名: 值 }）
 * @param service 控制服务类型（默认 AVTransport）
 * @param timeoutMs 请求超时毫秒（默认 8000）
 * @returns 响应 XML 文本
 */
const soapRequest = async (
  device: DlnaDevice,
  action: string,
  args: Record<string, string>,
  service: DlnaService = "AVTransport",
  timeoutMs = 8000,
): Promise<string> => {
  const controlUrl = service === "RenderingControl" ? device.rcControlUrl : device.controlUrl;
  if (!controlUrl) {
    throw new Error(`设备缺少 ${service} 控制地址`);
  }
  const serviceUrn = SOAP_SERVICE_URN[service];
  const body = Object.entries(args)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join("");

  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    // encodingStyle 为 UPnP 规范要求：部分严格实现（如 Platinum SDK，雷鸟原生）缺失时拒绝所有请求
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    "<s:Body>",
    `<u:${action} xmlns:u="${serviceUrn}">`,
    body,
    `</u:${action}>`,
    "</s:Body>",
    "</s:Envelope>",
  ].join("");

  let res: AxiosResponse<string>;
  try {
    res = await axios.post<string>(controlUrl, envelope, {
      timeout: timeoutMs,
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${serviceUrn}#${action}"`,
        "User-Agent": "PocketTune-DLNA/1.0",
      },
    });
  } catch (error) {
    // 带出渲染器返回的具体错误体，便于诊断（端口失效/服务重启等）
    if (axios.isAxiosError(error)) {
      const body = String(error.response?.data ?? "").slice(0, 300);
      serverLog.error(
        `❌ SOAP ${action} HTTP 错误: ${error.response?.status ?? "无响应"} 设备: ${device.name} 控制地址: ${controlUrl} 响应体: ${body}`,
      );
      const err = new Error(
        `SOAP ${action} HTTP ${error.response?.status ?? "无响应"}: ${body || error.message}`,
      );
      throw err;
    }
    throw error;
  }

  // SOAP 错误也可能返回 200，需检查 Fault
  if (res.data.includes("<s:Fault>") || res.data.includes("<s:fault>")) {
    const detail =
      extractSoapValue(res.data, "errorDescription") || extractSoapValue(res.data, "faultstring");
    throw new Error(`SOAP ${action} 失败: ${detail || "未知错误"}`);
  }
  return res.data;
};

/**
 * SOAP 参数值转义（URL 中的 &、< 等特殊字符）
 */
const escapeSoapValue = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 延时工具
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// XML 文本节点转义（DIDL 内部用）
const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 安全提取 URL 扩展名（失败返回空串）
const safePathExt = (url: string): string => {
  try {
    const pathname = new URL(url).pathname;
    return pathname.includes(".") ? pathname.slice(pathname.lastIndexOf(".") + 1) : "";
  } catch {
    return "";
  }
};

/**
 * 按音频地址扩展名推断 MIME（推断失败回退 audio/mpeg，多数渲染器会嗅探实际格式）
 * @param url 音频地址
 */
export const audioMimeFromUrl = (url: string): string => {
  const ext = (safePathExt(url) || "").toLowerCase();
  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg",
    flac: "audio/flac",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    ape: "audio/ape",
    wma: "audio/x-ms-wma",
  };
  return mimeMap[ext] ?? "audio/mpeg";
};

/**
 * 构造 DIDL-Lite 元数据（严格的原生渲染器常要求非空元数据才接受 URI 并拉流）
 * @param url 媒体地址
 * @param mime MIME 类型
 * @param meta 展示元数据：标题/歌手/专辑/封面（电视端 now-playing 展示用）
 */
export const buildDidlMetadata = (
  url: string,
  mime: string,
  meta: { title: string; artist?: string; album?: string; albumArt?: string },
): string => {
  // 视频投送声明 videoItem，避免严格渲染器按音频处理
  const upnpClass = mime.startsWith("video/")
    ? "object.item.videoItem.movie"
    : "object.item.audioItem.musicTrack";
  // 歌手双写 upnp:artist 与 dc:creator，兼容不同渲染器的读取习惯
  const artistXml = meta.artist
    ? `<upnp:artist>${escapeXml(meta.artist)}</upnp:artist><dc:creator>${escapeXml(meta.artist)}</dc:creator>`
    : "";
  const albumXml = meta.album ? `<upnp:album>${escapeXml(meta.album)}</upnp:album>` : "";
  // 音频投送且带封面时附加 albumArtURI（纯音频直投模式下电视端封面展示用）
  const albumArtXml =
    !mime.startsWith("video/") && meta.albumArt
      ? `<upnp:albumArtURI>${escapeXml(meta.albumArt)}</upnp:albumArtURI>`
      : "";
  return (
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">` +
    `<item id="0" restricted="1">` +
    `<dc:title>${escapeXml(meta.title)}</dc:title>` +
    artistXml +
    albumXml +
    `<upnp:class>${upnpClass}</upnp:class>` +
    albumArtXml +
    `<res protocolInfo="http-get:*:${mime}:*">${escapeXml(url)}</res>` +
    `</item></DIDL-Lite>`
  );
};

/**
 * 设置渲染器播放地址并播放
 * SetURI 后电视需要时间切换流，Play 延后执行；Play 失败降级为日志
 * （部分渲染器忙于拉流时直接挂断连接，多数收到 URI 后也会自动开播）
 * @param device 目标设备
 * @param url 媒体绝对地址
 * @param meta 媒体元数据（可选，DIDL-Lite XML）
 */
export const dlnaSetUriAndPlay = async (
  device: DlnaDevice,
  url: string,
  meta = "",
): Promise<void> => {
  // 先停止当前会话：标准 DLNA 客户端做法，避免上次会话状态机占用导致 SetURI 被拒
  await soapRequest(device, "Stop", { InstanceID: "0" }).catch(() => undefined);
  await sleep(200);
  await soapRequest(device, "SetAVTransportURI", {
    InstanceID: "0",
    CurrentURI: escapeSoapValue(url),
    CurrentURIMetaData: escapeSoapValue(meta || ""),
  });
  // 等待渲染器完成拉流准备，避免 Play 被忙状态的栈挂断
  await sleep(1500);
  try {
    await soapRequest(device, "Play", { InstanceID: "0", Speed: "1" });
  } catch (error) {
    // Play 失败不阻断流程：渲染器很可能已自动开播，由状态轮询反映真实情况
    serverLog.warn(
      `⚠️ Play 指令失败（不阻断，可能已自动开播）: ${error instanceof Error ? error.message : error}`,
    );
  }
};

/**
 * 暂停播放
 */
export const dlnaPause = async (device: DlnaDevice): Promise<void> => {
  await soapRequest(device, "Pause", { InstanceID: "0" });
};

/**
 * 恢复播放
 */
export const dlnaResume = async (device: DlnaDevice): Promise<void> => {
  await soapRequest(device, "Play", { InstanceID: "0", Speed: "1" });
};

/**
 * 停止播放
 */
export const dlnaStop = async (device: DlnaDevice): Promise<void> => {
  await soapRequest(device, "Stop", { InstanceID: "0" });
};

/**
 * 跳转到指定时间
 * @param seconds 目标时间（秒）
 */
export const dlnaSeek = async (device: DlnaDevice, seconds: number): Promise<void> => {
  const time = new Date(seconds * 1000).toISOString().slice(11, 19);
  await soapRequest(device, "Seek", { InstanceID: "0", Unit: "REL_TIME", Target: time });
};

/**
 * 设置渲染器音量（RenderingControl 服务）
 * @param device 目标设备
 * @param volume 音量（0-100 整数）
 */
export const dlnaSetVolume = async (device: DlnaDevice, volume: number): Promise<void> => {
  const value = Math.max(0, Math.min(100, Math.round(volume)));
  await soapRequest(
    device,
    "SetVolume",
    { InstanceID: "0", Channel: "Master", DesiredVolume: String(value) },
    "RenderingControl",
  );
};

/**
 * 设置渲染器静音（RenderingControl 服务）
 * @param device 目标设备
 * @param muted 是否静音
 */
export const dlnaSetMute = async (device: DlnaDevice, muted: boolean): Promise<void> => {
  await soapRequest(
    device,
    "SetMute",
    { InstanceID: "0", Channel: "Master", DesiredMute: muted ? "1" : "0" },
    "RenderingControl",
  );
};

/**
 * 查询渲染器当前音量（失败返回 null，不阻断主流程）
 */
const dlnaGetVolume = async (device: DlnaDevice, timeoutMs = 8000): Promise<number | null> => {
  try {
    const xml = await soapRequest(
      device,
      "GetVolume",
      { InstanceID: "0", Channel: "Master" },
      "RenderingControl",
      timeoutMs,
    );
    const raw = extractSoapValue(xml, "CurrentVolume");
    const volume = Number(raw);
    return Number.isFinite(volume) ? volume : null;
  } catch {
    return null;
  }
};

/**
 * 查询渲染器静音状态（失败返回 null，不阻断主流程）
 */
const dlnaGetMute = async (device: DlnaDevice, timeoutMs = 8000): Promise<boolean | null> => {
  try {
    const xml = await soapRequest(
      device,
      "GetMute",
      { InstanceID: "0", Channel: "Master" },
      "RenderingControl",
      timeoutMs,
    );
    return extractSoapValue(xml, "CurrentMute") === "1";
  } catch {
    return null;
  }
};

/**
 * 查询渲染器播放状态与进度（附带音量/静音，失败时置 null）
 */
export const dlnaGetStatus = async (device: DlnaDevice): Promise<DlnaTransportState> => {
  // 状态查询统一用短超时：电视离线时轮询失败更快暴露
  const [transportXml, positionXml] = await Promise.all([
    soapRequest(device, "GetTransportInfo", { InstanceID: "0" }, "AVTransport", 5000),
    soapRequest(device, "GetPositionInfo", { InstanceID: "0" }, "AVTransport", 5000),
  ]);

  const state = extractSoapValue(transportXml, "CurrentTransportState");
  const position = extractSoapValue(positionXml, "RelTime");
  const trackDuration = extractSoapValue(positionXml, "TrackDuration");

  // 音量/静音独立查询：设备无 RenderingControl 时返回 null，前端自动忽略
  const [volume, muted] = await Promise.all([
    dlnaGetVolume(device, 5000),
    dlnaGetMute(device, 5000),
  ]);

  return {
    playing: state === "PLAYING",
    state,
    currentTime: parseUpnpTime(position),
    duration: parseUpnpTime(trackDuration),
    volume,
    muted,
  };
};
