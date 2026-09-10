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
  dlnaSetVolume,
  dlnaSetMute,
  buildDidlMetadata,
  audioMimeFromUrl,
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
 * 投送任务状态（封面视频合成耗时长，投送请求立即返回，前端轮询任务结果）
 */
interface CastTask {
  state: "pending" | "running" | "done" | "error" | "cancelled";
  message: string;
  createdAt: number;
}

// 任务表与自增 id（惰性清理已完成任务，防内存膨胀）
const castTasks = new Map<number, CastTask>();
let castTaskSeq = 0;
// 已完成任务保留时长（毫秒），之后惰性清理
const TASK_RETENTION = 10 * 60 * 1000;
// 投送串行队列：保证快速连续切歌时电视最终播放最新任务（避免并发覆盖错乱）
let castQueue: Promise<void> = Promise.resolve();

// 清理过期任务（pending/running 保留，避免误删未执行任务导致前端误报失效）
const pruneCastTasks = (): void => {
  const cutoff = Date.now() - TASK_RETENTION;
  for (const [id, task] of castTasks) {
    if (task.state === "pending" || task.state === "running") continue;
    if (task.createdAt < cutoff) castTasks.delete(id);
  }
};

/**
 * 投送任务入参（URL 均在路由同步阶段完成归一化，任务内只做合成与 SOAP 控制）
 */
interface CastTaskInput {
  uuid: string;
  targetUrl: string;
  coverAbsolute?: string;
  title?: string;
  artist?: string;
  /** 歌曲 id（可选，参与媒体缓存 key，签名参数变化仍命中缓存） */
  songId?: number;
  /** 电视可访问的入口基址（DLNA_BASE_URL 优先，否则为请求 host），合成媒体地址拼接用 */
  tvBase: string;
  lyrics?: {
    startTime: number;
    endTime: number;
    words: string;
    translatedLyric?: string;
  }[];
}

/**
 * 执行投送任务（合成封面视频 + 下发 SOAP 控制），串行入队
 * 内部捕获全部错误，不中断后续任务
 */
const runCastTask = (taskId: number, input: CastTaskInput): void => {
  const task = async (): Promise<void> => {
    // 任务不存在或已取消：直接跳过，不执行也不覆盖状态（检查与置位同处同步段，无竞态）
    const current = castTasks.get(taskId);
    if (!current || current.state === "cancelled") return;
    castTasks.set(taskId, { ...current, state: "running", message: "投送执行中" });
    try {
      // 封面视频模式：合成封面 + 音频的视频流，电视全屏显示封面与歌词（失败降级纯音频）
      let finalUrl = input.targetUrl;
      if (input.coverAbsolute) {
        try {
          const mediaUrl = await ensureCoverMedia(
            input.targetUrl,
            input.coverAbsolute,
            input.lyrics,
            { title: input.title, artist: input.artist },
            // songId 参与缓存 key：同一首歌签名参数变化仍命中缓存
            input.songId != null ? String(input.songId) : undefined,
          );
          if (mediaUrl) {
            // 生成的媒体为相对地址，补全为电视可达基址（与 normalizeUrl 相对分支一致）
            const videoUrl = mediaUrl.startsWith("/") ? `${input.tvBase}${mediaUrl}` : mediaUrl;
            if (videoUrl) {
              finalUrl = videoUrl;
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
      await withDeviceRetry(input.uuid, (device) => {
        serverLog.info(`📤 DLNA 投送: ${device.name} ← ${finalUrl}`);
        // 按媒体类型构造 DIDL-Lite 元数据（严格的原生渲染器要求非空元数据）
        const isVideo = finalUrl.includes("/api/dlna/media");
        // 纯音频直投：按扩展名推断真实 MIME，并携带封面供电视端展示
        const mime = isVideo ? "video/mp4" : audioMimeFromUrl(finalUrl);
        const meta = buildDidlMetadata(
          finalUrl,
          input.title || "PocketTune",
          mime,
          isVideo ? undefined : input.coverAbsolute,
        );
        return dlnaSetUriAndPlay(device, finalUrl, meta);
      });
      castTasks.set(taskId, { state: "done", message: "投送成功", createdAt: Date.now() });
    } catch (error) {
      serverLog.error("❌ 投送失败:", error instanceof Error ? error.message : error);
      castTasks.set(taskId, {
        state: "error",
        message: error instanceof Error ? error.message : "未知错误",
        createdAt: Date.now(),
      });
    }
  };
  // 串行队列：前一个任务完成后才执行本任务
  castQueue = castQueue.then(task, task);
  void castQueue.catch(() => undefined);
};
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

  // 投送前连通性探测：验证设备 SOAP 控制链路真实可达
  // 含端口漂移自愈：控制地址失效时自动重扫并重试一次
  fastify.post(
    "/dlna/probe",
    async (req: FastifyRequest<{ Body: { uuid?: string } }>, reply: FastifyReply) => {
      const { uuid } = req.body ?? {};
      if (!uuid) {
        return reply.code(400).send({ code: 400, message: "缺少 uuid 参数" });
      }
      // 设备缓存未命中时 getDevice 会自动补扫
      let device = await getDevice(uuid);
      let reachable = false;
      if (device) {
        try {
          await dlnaGetStatus(device);
          reachable = true;
        } catch {
          reachable = false;
        }
      }
      // 不可达：电视服务端口可能已漂移，强制重扫后重试一次
      if (!reachable) {
        await refreshDevices(true);
        device = await getDevice(uuid);
        if (device) {
          try {
            await dlnaGetStatus(device);
            reachable = true;
          } catch {
            reachable = false;
          }
        }
      }
      if (!reachable) {
        serverLog.warn("⚠️ 设备连通性探测失败:", uuid);
      }
      return reply.send({
        code: 200,
        data: { uuid, reachable, name: device?.name ?? null },
      });
    },
  );

  // 投送媒体到目标设备并播放（异步任务：立即返回 taskId，前端轮询任务结果）
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
          /** 当前歌曲 id（可选，参与媒体缓存 key） */
          songId?: number;
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
      const { uuid, url, cover, title, artist, songId, lyrics } = req.body ?? {};
      if (!uuid || !url) {
        return reply.code(400).send({ code: 400, message: "缺少 uuid 或 url 参数" });
      }
      const targetUrl = normalizeUrl(req, url);
      if (!targetUrl) {
        return reply.code(400).send({ code: 400, message: "不支持的投送地址" });
      }
      // 同步阶段完成全部 URL 归一化（异步任务内拿不到请求对象）
      const coverAbsolute = cover ? (normalizeUrl(req, cover) ?? cover) : undefined;
      const baseUrl = process.env.DLNA_BASE_URL?.trim().replace(/\/+$/, "");
      const protocol = req.protocol ?? "http";
      const host = req.headers.host ?? req.hostname;
      const tvBase = baseUrl ?? `${protocol}://${host}`;
      // 创建投送任务并异步执行（封面合成耗时长，不阻塞请求）
      const taskId = ++castTaskSeq;
      castTasks.set(taskId, { state: "pending", message: "", createdAt: Date.now() });
      pruneCastTasks();
      runCastTask(taskId, {
        uuid,
        targetUrl,
        coverAbsolute,
        title,
        artist,
        songId,
        tvBase,
        lyrics,
      });
      return reply.send({ code: 200, data: { taskId }, message: "投送任务已提交" });
    },
  );

  // 预合成下一首的封面视频（只填缓存不投送）：真正切歌时缓存命中，电视秒切
  fastify.post(
    "/dlna/prewarm",
    async (
      req: FastifyRequest<{
        Body: {
          url?: string;
          cover?: string;
          title?: string;
          artist?: string;
          songId?: number;
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
      const { url, cover, title, artist, songId, lyrics } = req.body ?? {};
      if (!url) {
        return reply.code(400).send({ code: 400, message: "缺少 url 参数" });
      }
      const targetUrl = normalizeUrl(req, url);
      if (!targetUrl) {
        return reply.code(400).send({ code: 400, message: "不支持的投送地址" });
      }
      const coverAbsolute = cover ? (normalizeUrl(req, cover) ?? cover) : undefined;
      // 后台执行不阻塞响应；与真实投送共用 ensureCoverMedia（同 key 命中缓存，inFlight 去重）
      void ensureCoverMedia(
        targetUrl,
        coverAbsolute,
        lyrics,
        { title, artist },
        songId != null ? String(songId) : undefined,
      )
        .then((result) =>
          serverLog.info(
            result
              ? `🔥 预合成完成: songId=${songId ?? "?"}`
              : `⚠️ 预合成未产出（切歌时将常规合成）: songId=${songId ?? "?"}`,
          ),
        )
        .catch((error) =>
          serverLog.warn(
            "⚠️ 预合成异常（已忽略）:",
            error instanceof Error ? error.message : error,
          ),
        );
      return reply.send({ code: 200, message: "预合成已提交" });
    },
  );

  // 查询投送任务状态（投送结果异步确认用）
  fastify.get(
    "/dlna/task",
    async (req: FastifyRequest<{ Querystring: { id?: string } }>, reply: FastifyReply) => {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ code: 400, message: "缺少有效的任务 id" });
      }
      const task = castTasks.get(id);
      if (!task) {
        return reply.send({ code: 200, data: null });
      }
      return reply.send({ code: 200, data: { state: task.state, message: task.message } });
    },
  );

  // 取消投送任务：仅 pending 可取消，任务不存在/已运行/已完成时幂等返回成功
  fastify.post(
    "/dlna/task/cancel",
    async (req: FastifyRequest<{ Body: { id?: number } }>, reply: FastifyReply) => {
      const { id } = req.body ?? {};
      const task = typeof id === "number" ? castTasks.get(id) : undefined;
      if (typeof id === "number" && task && task.state === "pending") {
        castTasks.set(id, { ...task, state: "cancelled", message: "已取消" });
      }
      return reply.send({ code: 200 });
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
        // 解析 bytes=start-end（bytes=-N 为 suffix range，取末尾 N 字节）
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match) {
          const rawStart = match[1];
          const rawEnd = match[2];
          let start: number;
          let end: number;
          if (!rawStart && rawEnd) {
            // suffix range：start 为距文件末尾 rawEnd 字节处
            const suffixLen = Math.min(Number(rawEnd), size);
            start = size - suffixLen;
            end = size - 1;
          } else {
            start = rawStart ? Number(rawStart) : 0;
            end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
          }
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
            case "volume":
              if (typeof value !== "number" || value < 0 || value > 100) {
                throw new Error("缺少有效的音量值");
              }
              return dlnaSetVolume(device, value);
            case "mute":
              return dlnaSetMute(device, value === 1);
            default:
              throw new Error(`不支持的指令: ${action}`);
          }
        });
        return reply.send({ code: 200, message: "指令已下发" });
      } catch (error) {
        serverLog.error("❌ 控制失败:", error instanceof Error ? error.message : error);
        const message = error instanceof Error ? error.message : "未知错误";
        // 参数类错误返回 400，其余视为设备通信失败
        const isParamError =
          message.includes("不支持的指令") ||
          message.includes("seek 时间") ||
          message.includes("音量值");
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
        // 状态轮询不做重扫重试：电视离线时避免高频轮询触发全网 SSDP 扫描
        const device = await getDevice(uuid);
        if (!device) throw new Error("设备不在线，请重新扫描");
        const state = await dlnaGetStatus(device);
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
