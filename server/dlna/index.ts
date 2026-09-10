// DLNA 局域网投送 API：设备发现、投送与控制（含失败自动刷新重试）
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serverLog } from "../utils/logger";
import type { DlnaDevice } from "./ssdp";
import {
  dlnaSetUriAndPlay,
  dlnaPause,
  dlnaResume,
  dlnaStop,
  dlnaSeek,
  dlnaGetStatus,
  buildDidlMetadata,
} from "./avtransport";
import { discoverWithDebug, getDevice, refreshDevices, startDeviceWatcher } from "./deviceManager";
import { ensureCoverMedia, getMediaFile, ensureTokenIndex } from "./media";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { Readable } from "node:stream";

/**
 * 归一化投送地址为渲染器可访问的绝对地址
 * 优先使用 DLNA_BASE_URL 环境变量（固定基址，与访问入口解耦）
 * 未配置时用请求 host 补全（默认行为）
 */
const normalizeUrl = (req: FastifyRequest, rawUrl: string): string | null => {
  if (!rawUrl) return null;
  // 绝对地址：优先解析出路径部分，配置了 DLNA_BASE_URL 且原地址与请求同源时强制重写基址
  if (/^https?:\/\//i.test(rawUrl)) {
    const baseUrl = process.env.DLNA_BASE_URL?.trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(rawUrl);
      const requestHost = req.headers.host ?? req.hostname;
      const sameOrigin = parsed.host === requestHost;
      // 与访问入口同源的代理地址：交给 DLNA_BASE_URL（或请求 host）决定最终基址
      if (sameOrigin) {
        if (baseUrl) return `${baseUrl}${parsed.pathname}${parsed.search}`;
        const protocol = req.protocol ?? "http";
        return `${protocol}://${requestHost}${parsed.pathname}${parsed.search}`;
      }
      // 异源地址（第三方直链等）原样透传
      return rawUrl;
    } catch {
      return rawUrl;
    }
  }
  if (rawUrl.startsWith("/")) {
    // 环境变量强制指定基址（如 http://192.168.5.100:25884），电视固定走局域网拉流
    const baseUrl = process.env.DLNA_BASE_URL?.trim().replace(/\/+$/, "");
    if (baseUrl) return `${baseUrl}${rawUrl}`;
    const protocol = req.protocol ?? "http";
    const host = req.headers.host ?? req.hostname;
    return `${protocol}://${host}${rawUrl}`;
  }
  return null;
};

/**
 * 带自动恢复的设备指令执行
 * 首次失败（控制地址过期/服务重启）时重新扫描设备并重试一次
 */
const withDeviceRetry = async <T>(
  uuid: string,
  action: (device: DlnaDevice) => Promise<T>,
): Promise<T> => {
  const device = await getDevice(uuid);
  if (!device) throw new Error("设备不在线，请重新扫描");
  try {
    return await action(device);
  } catch (error) {
    // 重新扫描刷新设备信息（电视服务可能已换端口）后重试一次
    serverLog.warn(
      `⚠️ 指令首次执行失败，尝试刷新设备后重试: ${error instanceof Error ? error.message : error}`,
    );
    await refreshDevices(true);
    const fresh = await getDevice(uuid);
    if (!fresh) throw error;
    return await action(fresh);
  }
};

/**
 * 初始化 DLNA API
 * 注册路由：/dlna/discover /dlna/play /dlna/control /dlna/status
 */
export const initDlnaAPI = async (fastify: FastifyInstance): Promise<void> => {
  // 启动设备信息自动刷新（跟踪电视服务端口变化）
  startDeviceWatcher();

  // 扫描局域网 DLNA 渲染器设备
  fastify.post("/dlna/discover", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { devices, debug } = await discoverWithDebug();
      serverLog.info("🔍 DLNA 发现诊断:", JSON.stringify(debug));
      return reply.send({
        code: 200,
        data: devices.map((device) => ({
          uuid: device.uuid,
          name: device.name,
          deviceType: device.deviceType,
        })),
        debug,
      });
    } catch (error) {
      serverLog.error("❌ 设备扫描失败:", error);
      return reply.code(500).send({ code: 500, message: "设备扫描失败" });
    }
  });

  // 投送媒体到目标设备并播放
  fastify.post(
    "/dlna/play",
    async (
      req: FastifyRequest<{
        Body: {
          uuid?: string;
          url?: string;
          cover?: string;
          title?: string;
          artist?: string;
          lyrics?: {
            startTime: number;
            endTime: number;
            words: string;
            translatedLyric?: string;
          }[];
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { uuid, url, cover, title, artist, lyrics } = req.body ?? {};
      if (!uuid || !url) {
        return reply.code(400).send({ code: 400, message: "缺少 uuid 或 url 参数" });
      }
      let targetUrl = normalizeUrl(req, url);
      if (!targetUrl) {
        return reply.code(400).send({ code: 400, message: "不支持的投送地址" });
      }
      // 封面视频模式：合成封面 + 音频的视频流，电视全屏显示封面与歌词（失败降级纯音频）
      if (cover) {
        const coverAbsolute = normalizeUrl(req, cover) ?? cover;
        try {
          const mediaUrl = await ensureCoverMedia(targetUrl, coverAbsolute, lyrics, {
            title,
            artist,
          });
          if (mediaUrl) {
            // 生成的媒体走相对地址，再次经过 normalizeUrl 补全电视可达基址
            const videoUrl = normalizeUrl(req, mediaUrl);
            if (videoUrl) {
              targetUrl = videoUrl;
              serverLog.info("🎬 封面视频模式已启用");
            }
          }
        } catch (error) {
          serverLog.warn(
            "⚠️ 封面视频合成异常，降级纯音频:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      try {
        await withDeviceRetry(uuid, (device) => {
          // 记录投送目标与最终拉流地址，便于验证 DLNA_BASE_URL 是否生效
          serverLog.info(`📤 DLNA 投送: ${device.name} ← ${targetUrl}`);
          // 按媒体类型构造 DIDL-Lite 元数据（严格的原生渲染器要求非空元数据）
          const isVideo = targetUrl.includes("/api/dlna/media");
          const mime = isVideo ? "video/mp4" : "audio/mpeg";
          const meta = buildDidlMetadata(targetUrl, title || "PocketTune", mime);
          return dlnaSetUriAndPlay(device, targetUrl, meta);
        });
        return reply.send({ code: 200, message: "投送成功" });
      } catch (error) {
        serverLog.error("❌ 投送失败:", error instanceof Error ? error.message : error);
        return reply.code(502).send({
          code: 502,
          message: `投送失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
      }
    },
  );

  // 封面视频流：电视拉流端点（支持 Range 拖动进度）
  fastify.get(
    "/dlna/media",
    async (req: FastifyRequest<{ Querystring: { token?: string } }>, reply: FastifyReply) => {
      // 进程重启后首次拉流：先从磁盘恢复 token 索引
      await ensureTokenIndex();
      const token = req.query.token ?? "";
      const file = getMediaFile(token);
      if (!file || !existsSync(file)) {
        return reply.code(404).send({ code: 404, message: "媒体不存在或已过期" });
      }
      const size = statSync(file).size;
      const range = req.headers.range;
      // 基础响应头：禁用 nginx 缓冲，保证流式推给电视
      const baseHeaders: Record<string, string> = {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      };
      if (range) {
        // 解析 bytes=start-end
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match) {
          const start = match[1] ? Number(match[1]) : 0;
          const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
            return reply.code(416).header("Content-Range", `bytes */${size}`).send();
          }
          const stream = createReadStream(file, { start, end });
          return reply
            .code(206)
            .headers({
              ...baseHeaders,
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Content-Length": String(end - start + 1),
            })
            .send(stream as unknown as Readable);
        }
      }
      // 无 Range：全量返回
      return reply
        .code(200)
        .headers({ ...baseHeaders, "Content-Length": String(size) })
        .send(createReadStream(file) as unknown as Readable);
    },
  );

  // 控制播放：pause / resume / stop / seek
  fastify.post(
    "/dlna/control",
    async (
      req: FastifyRequest<{
        Body: { uuid?: string; action?: string; value?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { uuid, action, value } = req.body ?? {};
      if (!uuid || !action) {
        return reply.code(400).send({ code: 400, message: "缺少 uuid 或 action 参数" });
      }
      try {
        await withDeviceRetry(uuid, (device) => {
          switch (action) {
            case "pause":
              return dlnaPause(device);
            case "resume":
              return dlnaResume(device);
            case "stop":
              return dlnaStop(device);
            case "seek":
              if (typeof value !== "number" || value < 0) {
                throw new Error("缺少有效的 seek 时间");
              }
              return dlnaSeek(device, value);
            default:
              throw new Error(`不支持的指令: ${action}`);
          }
        });
        return reply.send({ code: 200, message: "指令已下发" });
      } catch (error) {
        serverLog.error("❌ 控制失败:", error instanceof Error ? error.message : error);
        const message = error instanceof Error ? error.message : "未知错误";
        // 参数类错误返回 400，其余视为设备通信失败
        const isParamError = message.includes("不支持的指令") || message.includes("seek 时间");
        return reply
          .code(isParamError ? 400 : 502)
          .send({ code: isParamError ? 400 : 502, message: `控制失败: ${message}` });
      }
    },
  );

  // 查询渲染器播放状态与进度
  fastify.get(
    "/dlna/status",
    async (req: FastifyRequest<{ Querystring: { uuid?: string } }>, reply: FastifyReply) => {
      const uuid = req.query.uuid;
      if (!uuid) {
        return reply.code(400).send({ code: 400, message: "缺少 uuid 参数" });
      }
      try {
        const state = await withDeviceRetry(uuid, (device) => dlnaGetStatus(device));
        return reply.send({ code: 200, data: state });
      } catch (error) {
        serverLog.error("❌ 状态查询失败:", error instanceof Error ? error.message : error);
        return reply.code(502).send({
          code: 502,
          message: `状态查询失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
      }
    },
  );

  serverLog.info("🌐 Register DlnaAPI successfully");
};
