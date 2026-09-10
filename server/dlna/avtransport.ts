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

/**
 * 发送 SOAP 指令到渲染器 AVTransport 服务
 * @param device 目标设备
 * @param action SOAP 动作名
 * @param args 动作参数（{ 参数名: 值 }）
 * @returns 响应 XML 文本
 */
const soapRequest = async (
  device: DlnaDevice,
  action: string,
  args: Record<string, string>,
): Promise<string> => {
  const body = Object.entries(args)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join("");

  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    // encodingStyle 为 UPnP 规范要求：部分严格实现（如 Platinum SDK，雷鸟原生）缺失时拒绝所有请求
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    "<s:Body>",
    `<u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">`,
    body,
    `</u:${action}>`,
    "</s:Body>",
    "</s:Envelope>",
  ].join("");

  let res: AxiosResponse<string>;
  try {
    res = await axios.post<string>(device.controlUrl, envelope, {
      timeout: 8000,
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`,
        "User-Agent": "PocketTune-DLNA/1.0",
      },
    });
  } catch (error) {
    // 带出渲染器返回的具体错误体，便于诊断（端口失效/服务重启等）
    if (axios.isAxiosError(error)) {
      const body = String(error.response?.data ?? "").slice(0, 300);
      serverLog.error(
        `❌ SOAP ${action} HTTP 错误: ${error.response?.status ?? "无响应"} 设备: ${device.name} 控制地址: ${device.controlUrl} 响应体: ${body}`,
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

/**
 * 构造 DIDL-Lite 元数据（严格的原生渲染器常要求非空元数据才接受 URI 并拉流）
 * @param url 媒体地址
 * @param title 标题
 * @param mime MIME 类型
 */
export const buildDidlMetadata = (url: string, title: string, mime: string): string =>
  `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
  `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">` +
  `<item id="0" restricted="1">` +
  `<dc:title>${escapeXml(title)}</dc:title>` +
  `<upnp:class>object.item.audioItem.musicTrack</upnp:class>` +
  `<res protocolInfo="http-get:*:${mime}:*">${escapeXml(url)}</res>` +
  `</item></DIDL-Lite>`;

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
 * 查询渲染器播放状态与进度
 */
export const dlnaGetStatus = async (device: DlnaDevice): Promise<DlnaTransportState> => {
  const [transportXml, positionXml] = await Promise.all([
    soapRequest(device, "GetTransportInfo", { InstanceID: "0" }),
    soapRequest(device, "GetPositionInfo", { InstanceID: "0" }),
  ]);

  const state = extractSoapValue(transportXml, "CurrentTransportState");
  const position = extractSoapValue(positionXml, "RelTime");
  const trackDuration = extractSoapValue(positionXml, "TrackDuration");

  return {
    playing: state === "PLAYING",
    state,
    currentTime: parseUpnpTime(position),
    duration: parseUpnpTime(trackDuration),
  };
};
