// DLNA 局域网投送 API：设备发现、投送与控制
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serverLog } from "../utils/logger";
import { discoverDlnaDevices, type DlnaDevice } from "./ssdp";
import {
  dlnaSetUriAndPlay,
  dlnaPause,
  dlnaResume,
  dlnaStop,
  dlnaSeek,
  dlnaGetStatus,
} from "./avtransport";

// 设备缓存：扫描后记录，供投送与控制使用
const deviceCache = new Map<string, DlnaDevice>();

// 将发现的设备写入缓存
const cacheDevices = (devices: DlnaDevice[]): void => {
  deviceCache.clear();
  devices.forEach((device) => deviceCache.set(device.uuid, device));
};

/**
 * 归一化投送地址为渲染器可访问的绝对地址
 * 相对路径（同源代理）用请求 host 补全
 */
const normalizeUrl = (req: FastifyRequest, rawUrl: string): string | null => {
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) {
    const protocol = req.protocol ?? "http";
    const host = req.headers.host ?? req.hostname;
    return `${protocol}://${host}${rawUrl}`;
  }
  return null;
};

// 按 uuid 获取设备，不存在则报错
const getDevice = (uuid: string): DlnaDevice | null => deviceCache.get(uuid) ?? null;

/**
 * 初始化 DLNA API
 * 注册路由：/dlna/discover /dlna/play /dlna/control /dlna/status
 */
export const initDlnaAPI = async (fastify: FastifyInstance): Promise<void> => {
  // 扫描局域网 DLNA 渲染器设备
  fastify.post("/dlna/discover", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { devices, debug } = await discoverDlnaDevices(3500);
      cacheDevices(devices);
      // 诊断信息同步输出到日志，便于容器内排查
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
    async (req: FastifyRequest<{ Body: { uuid?: string; url?: string } }>, reply: FastifyReply) => {
      const { uuid, url } = req.body ?? {};
      if (!uuid || !url) {
        return reply.code(400).send({ code: 400, message: "缺少 uuid 或 url 参数" });
      }
      const device = getDevice(uuid);
      if (!device) {
        return reply.code(404).send({ code: 404, message: "设备不在线，请重新扫描" });
      }
      const targetUrl = normalizeUrl(req, url);
      if (!targetUrl) {
        return reply.code(400).send({ code: 400, message: "不支持的投送地址" });
      }
      try {
        await dlnaSetUriAndPlay(device, targetUrl);
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
      const device = getDevice(uuid);
      if (!device) {
        return reply.code(404).send({ code: 404, message: "设备不在线，请重新扫描" });
      }
      try {
        switch (action) {
          case "pause":
            await dlnaPause(device);
            break;
          case "resume":
            await dlnaResume(device);
            break;
          case "stop":
            await dlnaStop(device);
            break;
          case "seek":
            if (typeof value !== "number" || value < 0) {
              return reply.code(400).send({ code: 400, message: "缺少有效的 seek 时间" });
            }
            await dlnaSeek(device, value);
            break;
          default:
            return reply.code(400).send({ code: 400, message: `不支持的指令: ${action}` });
        }
        return reply.send({ code: 200, message: "指令已下发" });
      } catch (error) {
        serverLog.error("❌ 控制失败:", error instanceof Error ? error.message : error);
        return reply.code(502).send({
          code: 502,
          message: `控制失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
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
      const device = getDevice(uuid);
      if (!device) {
        return reply.code(404).send({ code: 404, message: "设备不在线，请重新扫描" });
      }
      try {
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
