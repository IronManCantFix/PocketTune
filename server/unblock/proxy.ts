// 第三方解锁音源媒体代理：同源转发以绕过浏览器 CORS 限制
import axios, { type AxiosResponse } from "axios";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serverLog } from "../utils/logger";

// 允许代理的音源域名后缀白名单（同时用于防御 SSRF）
const ALLOWED_HOST_SUFFIXES = [
  "kuwo.cn",
  "kugou.com",
  "migu.cn",
  "miguvideo.com",
  "bilivideo.com",
  "bilibili.com",
  "gdstudio.xyz",
  "126.net",
  "163.com",
];

// 各音源对应的伪装 Referer
const REFERER_MAP: { suffix: string; referer: string }[] = [
  { suffix: "kuwo.cn", referer: "https://www.kuwo.cn/" },
  { suffix: "kugou.com", referer: "https://www.kugou.com/" },
  { suffix: "migu.cn", referer: "https://www.migu.cn/" },
  { suffix: "miguvideo.com", referer: "https://www.migu.cn/" },
  { suffix: "bilivideo.com", referer: "https://www.bilibili.com/" },
  { suffix: "bilibili.com", referer: "https://www.bilibili.com/" },
  { suffix: "163.com", referer: "https://music.163.com/" },
  { suffix: "126.net", referer: "https://music.163.com/" },
  { suffix: "gdstudio.xyz", referer: "https://music.gdstudio.xyz/" },
];

// 通用浏览器 UA
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 需要透传给客户端的响应头
const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
];

// 校验目标地址是否在白名单内
const isAllowedTarget = (rawUrl: string): URL | null => {
  try {
    const target = new URL(rawUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    const host = target.hostname;
    // 防御内网与本地地址
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(host)) {
      return null;
    }
    const allowed = ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
    return allowed ? target : null;
  } catch {
    return null;
  }
};

// 按目标域名挑选 Referer
const refererFor = (host: string): string =>
  REFERER_MAP.find((item) => host === item.suffix || host.endsWith(`.${item.suffix}`))?.referer ??
  "https://music.163.com/";

// 初始化媒体代理
export const initUnblockProxy = (fastify: FastifyInstance): void => {
  fastify.get(
    "/unblock/proxy",
    async (req: FastifyRequest<{ Querystring: { url?: string } }>, reply: FastifyReply) => {
      const rawUrl = req.query.url ?? "";
      const target = isAllowedTarget(rawUrl);
      if (!target) {
        return reply.code(400).send({ code: 400, message: "不支持的代理地址" });
      }

      try {
        // 流式转发，透传 Range 以支持拖动进度条
        const upstream: AxiosResponse<NodeJS.ReadableStream> = await axios.get(target.href, {
          responseType: "stream",
          timeout: 15000,
          maxRedirects: 5,
          headers: {
            "User-Agent": BROWSER_UA,
            Referer: refererFor(target.hostname),
            ...(req.headers.range ? { Range: req.headers.range } : {}),
          },
          validateStatus: () => true,
        });

        const headers: Record<string, string> = {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        for (const key of PASSTHROUGH_HEADERS) {
          const value = upstream.headers[key];
          if (value != null) headers[key] = String(value);
        }

        return reply.code(upstream.status).headers(headers).send(upstream.data);
      } catch (error) {
        serverLog.error("❌ 媒体代理请求失败:", error instanceof Error ? error.message : error);
        return reply.code(502).send({ code: 502, message: "媒体代理请求失败" });
      }
    },
  );
  serverLog.info("🌐 Register UnblockProxy successfully");
};
