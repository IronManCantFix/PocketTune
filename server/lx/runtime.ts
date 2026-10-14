// 洛雪自定义音源沙箱运行时：vm2 隔离执行脚本，提供 lx 宿主对象
import { VM } from "vm2";
import axios from "axios";
import { createHash, createCipheriv, publicEncrypt, randomBytes } from "crypto";
import { inflate as zlibInflate, deflate as zlibDeflate } from "zlib";
import { promisify } from "util";
import { serverLog } from "../utils/logger";
import { registerDynamicHost } from "../unblock/ssrf";
import type {
  LxApiInstance,
  LxLoadResult,
  LxRequestCallback,
  LxRequestHandler,
  LxRequestOptions,
  LxScriptMeta,
  LxSourceDeclaration,
} from "./types";

const inflateAsync = promisify(zlibInflate);
const deflateAsync = promisify(zlibDeflate);

/** 脚本同步执行超时 */
const RUN_TIMEOUT = 10_000;
/** 等待 inited 事件超时 */
const INIT_TIMEOUT = 3_000;
/** 单次 musicUrl 调用超时 */
const CALL_TIMEOUT = 15_000;
/** 脚本发起的单次 HTTP 请求超时 */
const REQUEST_TIMEOUT = 20_000;
/** 脚本发起的 HTTP 请求最大重定向次数 */
const MAX_REDIRECTS = 5;

/**
 * 切断沙箱对象与宿主的原型链联系
 * 沙箱内对象经 vm2 代理，直接透传会被脚本通过原型链反查宿主
 * @param value 待净化值
 */
export const decontextify = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  // Buffer 用 Uint8Array 中转，切断代理链
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(Uint8Array.from(value as Uint8Array));
  }
  if (Array.isArray(value)) {
    return value.map((item) => decontextify(item));
  }
  if (value instanceof Error) {
    const err = new Error(value.message);
    err.stack = value.stack;
    return err;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = decontextify((value as Record<string, unknown>)[key]);
  }
  return result;
};

/**
 * 从脚本头部 JSDoc 注释提取元数据
 * @param script 脚本源码
 */
export const extractMeta = (script: string): LxScriptMeta => {
  const meta: LxScriptMeta = { name: "", description: "", version: "", author: "", homepage: "" };
  const comment = script.match(/\/\*[*!]([\s\S]*?)\*\//);
  if (!comment) return meta;
  const body = comment[1];
  const pick = (key: string): string =>
    body.match(new RegExp(`@${key}\\s+(.+)`))?.[1]?.trim() ?? "";
  meta.name = pick("name");
  meta.description = pick("description");
  meta.version = pick("version");
  meta.author = pick("author");
  meta.homepage = pick("homepage") || pick("repository");
  return meta;
};

/**
 * 归一化 AES 算法名
 * 洛雪脚本对 mode 的传法不统一：有的传裸模式名（ecb/cbc），有的直接传完整算法名（aes-128-ecb）
 * 此处两种都兼容，避免拼出 aes-128-aes-128-ecb 这类非法名
 * @param mode 脚本传入的模式或完整算法名
 * @param key 密钥（用于推断密钥长度）
 */
const resolveAesAlgorithm = (mode: unknown, key: Buffer): string => {
  const raw = String(mode ?? "")
    .trim()
    .toLowerCase();
  // 已含 aes 前缀时视为完整算法名，直接使用
  if (raw.startsWith("aes-")) return raw;
  return `aes-${key.length * 8}-${raw || "cbc"}`;
};

/**
 * 构造沙箱内的 lx.request：同步返回取消函数，结果通过 callback 回传
 * 请求由宿主发起，天然不受浏览器 CORS 限制
 */
const createLxRequest = () => {
  return (url: string, options: LxRequestOptions, callback: LxRequestCallback): (() => void) => {
    const controller = new AbortController();
    // 沙箱内对象经 vm2 代理，先净化再交给 axios，避免原型链探测与序列化异常
    const opts = (decontextify(options ?? {}) ?? {}) as LxRequestOptions;
    const timeout = Math.min(Number(opts.timeout) || REQUEST_TIMEOUT, REQUEST_TIMEOUT);

    void (async () => {
      try {
        const target = typeof url === "string" ? url : String(url);
        const headers: Record<string, string> = { ...(opts.headers ?? {}) };
        let data: unknown = opts.body;
        // form 走 x-www-form-urlencoded，与洛雪桌面端行为一致
        if (opts.form && typeof opts.form === "object") {
          const search = new URLSearchParams();
          for (const [key, value] of Object.entries(opts.form as Record<string, unknown>)) {
            search.append(key, value == null ? "" : String(value));
          }
          data = search.toString();
          if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
          }
        }
        const response = await axios.request({
          url: target,
          method: String(opts.method ?? "get").toUpperCase(),
          headers,
          data,
          timeout,
          maxRedirects: MAX_REDIRECTS,
          signal: controller.signal,
          responseType: "text",
          // 保留原始文本，由下方按需解析，兼容非 JSON 响应
          transformResponse: [(raw: unknown) => raw],
          validateStatus: () => true,
        });
        const raw = response.data;
        let body: unknown = raw;
        // 尝试把 JSON 字符串解析为对象，脚本普遍按对象读取
        if (typeof raw === "string") {
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
        }
        const payload = {
          statusCode: response.status,
          statusMessage: response.statusText,
          headers: response.headers as Record<string, unknown>,
          body,
        };
        callback(null, decontextify(payload) as never, decontextify(body));
      } catch (error) {
        callback(decontextify(error), null, null);
      }
    })();

    return () => controller.abort();
  };
};

/**
 * 在 vm2 沙箱中加载洛雪脚本
 * @param script 脚本源码
 * @param id 脚本 id，用于日志与错误定位
 */
export const loadLxScript = async (script: string, id: string): Promise<LxLoadResult> => {
  const meta = extractMeta(script);
  let resolveInit: (() => void) | null = null;
  // 仅等待脚本主动发送 inited，超时由外部 Promise.race 兜底
  const initPromise = new Promise<void>((resolve) => {
    resolveInit = resolve;
  });

  let handler: LxRequestHandler | null = null;
  let sources: Record<string, LxSourceDeclaration> = {};

  const lxObject = {
    version: "2.0.0",
    // 对脚本声明为桌面环境，兼容绝大多数源
    env: "desktop",
    platform: "web",
    currentScriptInfo: {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
      homepage: meta.homepage,
      rawScript: script,
    },
    EVENT_NAMES: {
      request: "request",
      inited: "inited",
      updateAlert: "updateAlert",
    },
    request: createLxRequest(),
    utils: {
      buffer: {
        from: (data: unknown, encoding?: unknown) => Buffer.from(data as never, encoding as never),
        bufToString: (buffer: unknown, format?: unknown) =>
          Buffer.isBuffer(buffer)
            ? buffer.toString(format as never)
            : Buffer.from(buffer as never, "binary").toString(format as never),
      },
      crypto: {
        md5: (str: unknown) =>
          createHash("md5")
            .update(String(str ?? ""))
            .digest("hex"),
        aesEncrypt: (buffer: unknown, mode: unknown, key: unknown, iv: unknown) => {
          const keyBuf = Buffer.from(key as never);
          const ivBuf = iv === undefined || iv === null ? null : Buffer.from(iv as never);
          const cipher = createCipheriv(resolveAesAlgorithm(mode, keyBuf), keyBuf, ivBuf as never);
          return Buffer.concat([
            cipher.update(Buffer.from(buffer as never)) as never,
            cipher.final() as never,
          ]);
        },
        rsaEncrypt: (buffer: unknown, key: unknown) =>
          publicEncrypt(key as never, Buffer.from(buffer as never)),
        randomBytes: (size: unknown) => randomBytes(Number(size) || 16),
      },
      zlib: {
        inflate: async (buffer: unknown) =>
          inflateAsync(Buffer.from(buffer as never)) as Promise<Buffer>,
        deflate: async (buffer: unknown) =>
          deflateAsync(Buffer.from(buffer as never)) as Promise<Buffer>,
      },
    },
    send: (eventName: string, data: unknown) => {
      if (eventName !== "inited") return;
      const payload = data as { sources?: Record<string, LxSourceDeclaration> } | undefined;
      if (payload?.sources && typeof payload.sources === "object") {
        sources = payload.sources;
      }
      resolveInit?.();
    },
    on: (eventName: string, fn: unknown) => {
      if (eventName !== "request") return;
      if (typeof fn === "function") {
        handler = fn as LxRequestHandler;
      }
    },
  };

  // 沙箱 console：压制脚本噪音，仅 error 真正输出
  const sandboxConsole = {
    log: () => {},
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: (...args: unknown[]) => serverLog.debug(`[洛雪源] ${meta.name || id}`, ...args),
    trace: () => {},
    dir: () => {},
    table: () => {},
    group: () => {},
    groupEnd: () => {},
    time: () => {},
    timeEnd: () => {},
    assert: () => {},
    count: () => {},
    countReset: () => {},
    clear: () => {},
  };

  const sandbox: Record<string, unknown> = {
    console: sandboxConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob: (value: string) => Buffer.from(String(value), "base64").toString("binary"),
    btoa: (value: string) => Buffer.from(String(value), "binary").toString("base64"),
    lx: lxObject,
    process: {
      nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
        setTimeout(() => fn(...args), 0),
      env: { NODE_ENV: process.env["NODE_ENV"] || "production" },
    },
  };
  // 兼容混淆脚本对全局对象的引用
  sandbox["global"] = sandbox;
  sandbox["window"] = sandbox;
  sandbox["globalThis"] = sandbox;

  try {
    const vm = new VM({ timeout: RUN_TIMEOUT, sandbox, eval: true, wasm: false });
    vm.run(script, { filename: `lx-source-${id}.js` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `脚本执行失败: ${message}` };
  }

  try {
    // vm2 的 timeout 只约束同步代码，此处必须外部兜底，防止脚本永不发送 inited
    await Promise.race([
      initPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("初始化超时，脚本未发送 inited 事件")), INIT_TIMEOUT),
      ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }

  const platformKeys = Object.keys(sources);
  if (platformKeys.length === 0) {
    return { success: false, error: "脚本未注册任何音源平台" };
  }
  if (!handler) {
    return { success: false, error: "脚本未注册 request 处理器" };
  }

  const instance: LxApiInstance = { id, meta, sources, handler };
  serverLog.info(`🎵 洛雪源加载成功: ${meta.name || id}（平台: ${platformKeys.join(", ")}）`);
  return { success: true, instance };
};

/**
 * 调用脚本解析播放地址
 * @param instance 已加载的脚本实例
 * @param source 平台标识
 * @param quality 音质
 * @param musicInfo 歌曲信息
 */
export const callMusicUrl = async (
  instance: LxApiInstance,
  source: string,
  quality: string | null,
  musicInfo: Record<string, unknown>,
): Promise<string> => {
  const handler = instance.handler;
  if (!handler) throw new Error("脚本未注册 request 处理器");
  // vm2 要求入参为沙箱内可识别的纯对象，JSON 往返可净化原型链
  const payload = JSON.parse(
    JSON.stringify({ source, action: "musicUrl", info: { type: quality, musicInfo } }),
  );
  const result = await Promise.race([
    handler(payload),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("解析超时")), CALL_TIMEOUT),
    ),
  ]);
  const url = decontextify(result);
  if (typeof url !== "string" || !url) {
    throw new Error("脚本未返回有效的播放地址");
  }
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`脚本返回了非播放链接内容: ${trimmed.slice(0, 40)}`);
  }
  // 解析成功即登记域名，供媒体代理放行
  registerDynamicHost(trimmed);
  return trimmed;
};
