// 洛雪源管理接口：脚本导入、启用、排序与删除
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { serverLog } from "../utils/logger";
import {
  deleteScript,
  getStatus,
  importScript,
  listScripts,
  reorderScripts,
  toggleScript,
} from "./manager";
import { extractMeta } from "./runtime";

// 请求体类型
type ImportBody = { script?: unknown; url?: unknown };
type ToggleBody = { id?: unknown; enabled?: unknown };
type ReorderBody = { ids?: unknown };
type DeleteBody = { id?: unknown };

// 从远程地址拉取脚本，限制体积与超时
const fetchRemoteScript = async (url: string): Promise<string> => {
  const { default: axios } = await import("axios");
  const response = await axios.get<string>(url, {
    timeout: 15000,
    maxRedirects: 5,
    responseType: "text",
    transformResponse: [(raw: unknown) => raw],
    // 脚本体积上限 2MB
    maxContentLength: 2 * 1024 * 1024,
  });
  return String(response.data ?? "");
};

// 初始化洛雪源接口
export const initLxAPI = async (fastify: FastifyInstance) => {
  // 主信息
  fastify.get("/lx", (_, reply) => {
    reply.send({
      name: "LxSourceAPI",
      description: "洛雪（LX Music）自定义音源脚本运行时",
      author: "@PocketTune",
      content: "自定义源脚本来自第三方，仅供学习使用，请自行评估来源可信度。",
      ...getStatus(),
    });
  });

  // 脚本列表
  fastify.get("/lx/sources", (_, reply) => {
    return reply.send({ sources: listScripts(), ...getStatus() });
  });

  // 导入脚本（支持直接内容或远程地址）
  fastify.post(
    "/lx/sources",
    async (req: FastifyRequest<{ Body: ImportBody }>, reply: FastifyReply) => {
      const body = (req.body ?? {}) as ImportBody;
      let script = typeof body.script === "string" ? body.script : "";
      const remoteUrl = typeof body.url === "string" ? body.url.trim() : "";

      if (!script && remoteUrl) {
        if (!/^https?:\/\//i.test(remoteUrl)) {
          return reply.code(400).send({ success: false, error: "仅支持 http/https 地址" });
        }
        try {
          script = await fetchRemoteScript(remoteUrl);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          serverLog.error("❌ 洛雪源远程导入失败:", message);
          return reply.code(502).send({ success: false, error: `远程脚本拉取失败: ${message}` });
        }
      }

      if (!script) {
        return reply.code(400).send({ success: false, error: "缺少脚本内容或远程地址" });
      }

      const result = await importScript(script);
      if (!result.success) {
        return reply.code(400).send(result);
      }
      return reply.send({ ...result, meta: extractMeta(script) });
    },
  );

  // 启用/禁用脚本
  fastify.put(
    "/lx/sources/toggle",
    async (req: FastifyRequest<{ Body: ToggleBody }>, reply: FastifyReply) => {
      const body = (req.body ?? {}) as ToggleBody;
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) {
        return reply.code(400).send({ success: false, error: "缺少脚本 id" });
      }
      const enabled = body.enabled === true;
      const ok = await toggleScript(id, enabled);
      if (!ok) {
        return reply.code(404).send({ success: false, error: "脚本不存在" });
      }
      return reply.send({ success: true, id, enabled, status: getStatus() });
    },
  );

  // 调整优先级
  fastify.put(
    "/lx/sources/order",
    async (req: FastifyRequest<{ Body: ReorderBody }>, reply: FastifyReply) => {
      const body = (req.body ?? {}) as ReorderBody;
      if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
        return reply.code(400).send({ success: false, error: "ids 必须为字符串数组" });
      }
      const ok = reorderScripts(body.ids as string[]);
      if (!ok) {
        return reply.code(400).send({ success: false, error: "排序列表与现有脚本不匹配" });
      }
      return reply.send({ success: true, sources: listScripts() });
    },
  );

  // 删除脚本
  fastify.delete(
    "/lx/sources",
    async (req: FastifyRequest<{ Body: DeleteBody }>, reply: FastifyReply) => {
      const body = (req.body ?? {}) as DeleteBody;
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) {
        return reply.code(400).send({ success: false, error: "缺少脚本 id" });
      }
      if (!deleteScript(id)) {
        return reply.code(404).send({ success: false, error: "脚本不存在" });
      }
      return reply.send({ success: true, ...getStatus() });
    },
  );

  serverLog.info("🌐 Register LxSourceAPI successfully");
};
