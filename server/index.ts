import { initNcmAPI } from "./netease";
import { initUnblockAPI } from "./unblock";
import { initQQMusicAPI } from "./qqmusic";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastify from "fastify";
import { serverLog } from "./utils/logger";

// 是否为开发环境
const isDev = process.env.NODE_ENV !== "production";

const initAppServer = async () => {
  try {
    const server = fastify({
      routerOptions: {
        // 忽略尾随斜杠
        ignoreTrailingSlash: true,
      },
    });
    // 注册插件
    server.register(fastifyCookie);
    // 云盘上传等场景需解析大文件，放开 multipart 文件大小限制（默认继承 1MB bodyLimit）
    server.register(fastifyMultipart, {
      limits: {
        // 单文件上限：200MB，覆盖常见音频文件
        fileSize: 200 * 1024 * 1024,
      },
    });
    // 声明
    server.get("/api", (_, reply) => {
      reply.send({
        name: "SPlayer API",
        description: "SPlayer API service",
        author: "@imsyy",
        list: [
          {
            name: "NeteaseAPI (Enhanced)",
            url: "/api/netease",
          },
          {
            name: "UnblockAPI",
            url: "/api/unblock",
          },
          {
            name: "QQMusicAPI",
            url: "/api/qqmusic",
          },
        ],
      });
    });
    // 注册接口
    server.register(initNcmAPI, { prefix: "/api" });
    server.register(initUnblockAPI, { prefix: "/api" });
    server.register(initQQMusicAPI, { prefix: "/api" });
    // 启动端口
    const port = Number(process.env.PORT || 3000);
    await server.listen({ port, host: "0.0.0.0" });
    serverLog.info(
      `🌐 Starting AppServer on port ${port} (${isDev ? "development" : "production"})`,
    );
    return server;
  } catch (error) {
    serverLog.error("🚫 AppServer failed to start");
    throw error;
  }
};

export default initAppServer;

// 直接执行本文件时启动服务（pnpm api / Docker CMD）
import { pathToFileURL } from "url";
import { realpathSync } from "fs";

const isMainEntry = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
})();

if (isMainEntry) {
  initAppServer().catch((error) => {
    serverLog.error("🚫 AppServer 启动失败", error);
    process.exit(1);
  });
}
