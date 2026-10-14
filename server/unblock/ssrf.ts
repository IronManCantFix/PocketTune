// 媒体代理的地址安全校验：域名白名单 + DNS 解析后私网拦截
import { isIP } from "net";
import { lookup } from "dns/promises";

/** 静态白名单后缀（原有内置音源） */
const STATIC_SUFFIXES = [
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

/** 动态登记上限，超出后按最久未用淘汰 */
const DYNAMIC_LIMIT = 200;

/** 动态登记的第三方域名（洛雪脚本解析成功后写入），值为登记时间戳 */
const dynamicHosts = new Map<string, number>();

/**
 * 登记洛雪脚本解析出的域名，供媒体代理放行
 * @param rawUrl 脚本返回的播放地址
 */
export const registerDynamicHost = (rawUrl: string): void => {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (!host || (isIP(host) === 0 && !host.includes("."))) return;
    // 私网地址不登记，避免被当作放行依据
    if (isBlockedHostLiteral(host)) return;
    // 已存在时刷新时间戳（LRU 语义）
    dynamicHosts.delete(host);
    dynamicHosts.set(host, Date.now());
    // 超限时淘汰最久未用项
    while (dynamicHosts.size > DYNAMIC_LIMIT) {
      const oldest = dynamicHosts.keys().next().value;
      if (oldest === undefined) break;
      dynamicHosts.delete(oldest);
    }
  } catch {
    // 非法地址直接忽略
  }
};

/** 判断后缀是否匹配域名 */
const matchSuffix = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith(`.${suffix}`);

/** 判断域名是否在静态或动态白名单内 */
export const isAllowedHost = (host: string): boolean => {
  const lower = host.toLowerCase();
  if (STATIC_SUFFIXES.some((suffix) => matchSuffix(lower, suffix))) return true;
  return dynamicHosts.has(lower);
};

/** 获取当前动态登记数量，供诊断接口展示 */
export const getDynamicHostCount = (): number => dynamicHosts.size;

/**
 * 判断 IP 是否属于禁止访问的网段
 * 覆盖 IPv4 私有/回环/链路本地/保留段，以及 IPv6 回环/唯一本地/链路本地/IPv4 映射
 * @param address 已解析出的 IP 字符串
 */
export const isBlockedAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    // 0.0.0.0/8、10/8、127/8、192.168/16
    if (a === 0 || a === 10 || a === 127 || (a === 192 && b === 168)) return true;
    // 169.254/16 链路本地（含云厂商元数据端点 169.254.169.254）
    if (a === 169 && b === 254) return true;
    // 172.16/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 100.64/10 运营商级 NAT（Tailscale 等内网组网也落在此段）
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.0/24 IETF 协议专用段
    if (a === 192 && b === 0) return true;
    // 224/4 组播、240/4 保留
    if (a >= 224) return true;
    // 注意：198.18/15 不在此列。该段是 Clash/Surge 等代理的 fake-ip 默认段，
    // 自建用户普遍开启，拦截会导致所有外网域名被判为内网而全面失效；
    // 且该段并非本机或局域网地址，放行不会暴露内网服务。
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    // 回环、未指定
    if (lower === "::1" || lower === "::") return true;
    // IPv4 映射地址（::ffff:127.0.0.1 或 ::ffff:7f00:1）按 IPv4 规则复核
    const mapped = lower.match(/^::ffff:(.+)$/);
    if (mapped) {
      const rest = mapped[1];
      if (rest.includes(".")) return isBlockedAddress(rest);
      const groups = rest.split(":");
      if (groups.length === 2) {
        const hi = Number.parseInt(groups[0], 16);
        const lo = Number.parseInt(groups[1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
        }
      }
      return true;
    }
    // 唯一本地 fc00::/7、链路本地 fe80::/10、组播 ff00::/8
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(lower)) return true;
    if (lower.startsWith("ff")) return true;
    return false;
  }
  // 非合法 IP 一律拦截
  return true;
};

/**
 * 校验并解析单个主机名，返回可用于固定连接的地址
 * @param host 已归一化的主机名（不含方括号）
 */
export const resolveSafeAddresses = async (host: string): Promise<string[] | null> => {
  if (isIP(host) !== 0) {
    return isBlockedAddress(host) ? null : [host];
  }
  try {
    const records = await lookup(host, { all: true });
    const addresses = records.map((item) => item.address);
    if (addresses.length === 0) return null;
    if (addresses.some((address) => isBlockedAddress(address))) return null;
    return addresses;
  } catch {
    return null;
  }
};

/** axios/http 的 lookup 回调签名 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * 构造逐跳校验的 lookup，用于带重定向的流式代理
 * 每次建立连接前都对目标主机做私网校验，并把连接固定到已校验的地址，
 * 因此重定向链上的每一跳都不会绕过防护，也避免 DNS rebinding
 * @param onBlocked 命中拦截时的回调，便于记录日志
 */
export const createSafeLookup = (
  onBlocked?: (host: string) => void,
): ((hostname: string, options: { all?: boolean }, callback: LookupCallback) => void) => {
  return (hostname, options, callback) => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    void resolveSafeAddresses(host)
      .then((addresses) => {
        if (!addresses) {
          onBlocked?.(host);
          const error = new Error(`目标地址被拦截: ${host}`) as NodeJS.ErrnoException;
          error.code = "ERR_BLOCKED_ADDRESS";
          callback(error);
          return;
        }
        if (options.all) {
          callback(
            null,
            addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
          );
          return;
        }
        const first = addresses[0];
        callback(null, first, first.includes(":") ? 6 : 4);
      })
      .catch((error) => callback(error as NodeJS.ErrnoException));
  };
};

/**
 * 判断主机名字面量是否已明显指向内网（域名解析前的快速拦截）
 * 仅用于提前拒绝，真正的判定依赖 DNS 解析结果
 */
const isBlockedHostLiteral = (host: string): boolean => {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".local") || lower.endsWith(".internal")) return true;
  // 已是 IP 字面量时直接按 IP 规则判断（URL 解析已把混淆写法归一化）
  if (isIP(lower) !== 0) return isBlockedAddress(lower);
  return false;
};

/** 校验结果 */
export type SafeTarget =
  | { ok: true; url: URL; host: string; addresses: string[] }
  | { ok: false; reason: string };

/**
 * 校验代理目标：协议 + 白名单 + 主机名 + DNS 解析后的全部地址
 * 解析结果用于固定真实连接地址，防止 DNS rebinding
 * @param rawUrl 待校验的原始地址
 */
export const validateTarget = async (rawUrl: string): Promise<SafeTarget> => {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "地址格式非法" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { ok: false, reason: "仅支持 http/https 协议" };
  }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedHostLiteral(host)) {
    return { ok: false, reason: "禁止访问内网或本地地址" };
  }
  if (!isAllowedHost(host)) {
    return { ok: false, reason: "不支持的代理地址" };
  }
  // IP 字面量无需解析
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) return { ok: false, reason: "禁止访问内网或本地地址" };
    return { ok: true, url: target, host, addresses: [host] };
  }
  // 域名需解析并校验全部结果，任一命中内网即拒绝
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "域名解析失败" };
  }
  const addresses = records.map((item) => item.address);
  if (addresses.length === 0) {
    return { ok: false, reason: "域名解析为空" };
  }
  if (addresses.some((address) => isBlockedAddress(address))) {
    return { ok: false, reason: "域名解析到内网地址" };
  }
  return { ok: true, url: target, host, addresses };
};
