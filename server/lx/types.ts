// 洛雪（LX Music）自定义音源脚本的类型定义

/** 脚本头部 JSDoc 元数据 */
export type LxScriptMeta = {
  /** 源名称 */
  name: string;
  /** 源描述 */
  description: string;
  /** 源版本号 */
  version: string;
  /** 源作者 */
  author: string;
  /** 源主页 */
  homepage: string;
};

/** 脚本在 inited 事件中注册的单个平台 */
export type LxSourceDeclaration = {
  /** 平台显示名 */
  name?: string;
  /** 源类型，固定为 music */
  type?: string;
  /** 支持的 actions，非 local 源固定为 musicUrl */
  actions?: string[];
  /** 该平台支持的音质列表 */
  qualitys?: string[];
};

/** 持久化的脚本记录（写入 data/lx/sources.json） */
export type LxScriptRecord = {
  /** 脚本 id，同时作为文件名 */
  id: string;
  /** 脚本头部元数据 */
  meta: LxScriptMeta;
  /** 文件字节数 */
  size: number;
  /** 是否启用 */
  enabled: boolean;
  /** 导入时间（ISO 字符串） */
  createdAt: string;
  /** 脚本声明的平台列表，加载成功后回填 */
  platforms: string[];
  /** 最近一次加载错误，加载成功时为空 */
  error?: string;
};

/** 脚本运行时可用的动作 */
export type LxAction = "musicUrl" | "lyric" | "pic";

/** 沙箱内向宿主发起的请求选项 */
export type LxRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  /** 请求体，可为对象（自动 JSON 序列化）或字符串 */
  body?: unknown;
  /** 表单字段 */
  form?: Record<string, unknown>;
  /** 超时毫秒数 */
  timeout?: number;
};

/** lx.request 的响应结构 */
export type LxResponse = {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, unknown>;
  body: unknown;
};

/** lx.request 回调 */
export type LxRequestCallback = (err: unknown, resp: LxResponse | null, body: unknown) => void;

/** 脚本注册的 request 处理器入参 */
export type LxRequestPayload = {
  source: string;
  action: LxAction;
  info: {
    /** 音质，local 源为 null */
    type?: string | null;
    musicInfo: Record<string, unknown>;
  };
};

/** 脚本注册的 request 处理器，必须返回 Promise */
export type LxRequestHandler = (payload: LxRequestPayload) => Promise<unknown>;

/** 已加载成功的脚本实例 */
export type LxApiInstance = {
  /** 脚本 id */
  id: string;
  /** 脚本元数据 */
  meta: LxScriptMeta;
  /** 脚本注册的平台（平台 key → 声明信息） */
  sources: Record<string, LxSourceDeclaration>;
  /** 脚本注册的 request 处理器 */
  handler: LxRequestHandler | null;
};

/** 加载脚本的结果 */
export type LxLoadResult =
  | { success: true; instance: LxApiInstance }
  | { success: false; error: string };

/** 解析播放地址的结果 */
export type LxMusicUrlResult = {
  code: number;
  url: string | null;
  /** 命中的脚本名 */
  source?: string;
  /** 命中的脚本 id */
  sourceId?: string;
};
