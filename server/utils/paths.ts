// 服务端数据目录解析：容器/本地统一由 DATA_PATH 指定，未设置时回落到系统临时目录
import { existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { serverLog } from "./logger";

// 是否已确保目录存在
let ensured = false;

/**
 * 获取服务端数据根目录
 * 优先使用 DATA_PATH 环境变量（Docker 下由数据卷挂载），否则回落到临时目录
 */
export const getDataDir = (): string => {
  const configured = process.env["DATA_PATH"]?.trim();
  return configured && configured.length > 0 ? configured : join(tmpdir(), "splayer-server-data");
};

/**
 * 获取子目录的绝对路径，并确保其存在
 * @param segments 相对数据根目录的路径片段
 */
export const ensureDataDir = (...segments: string[]): string => {
  const dir = join(getDataDir(), ...segments);
  if (!ensured || !existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
      ensured = true;
    } catch (error) {
      serverLog.error("❌ 数据目录创建失败:", error);
    }
  }
  return dir;
};
