// 轻量配置存储，替代 electron-store：内存 Map + 临时目录 JSON 文件持久化
import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { serverLog } from "../utils/logger";

// 持久化文件路径
const storePath = join(tmpdir(), "splayer-server-config.json");

// 内存缓存
const memoryStore = new Map<string, unknown>();

// 是否已从磁盘加载
let loaded = false;

// 从磁盘加载配置
const loadStore = (): void => {
  if (loaded) return;
  loaded = true;
  if (!existsSync(storePath)) return;
  try {
    const raw = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, value]) => memoryStore.set(key, value));
    }
  } catch (error) {
    // 文件损坏时忽略，按空配置运行
    serverLog.error("❌ 配置文件读取失败:", error);
  }
};

// 持久化配置到磁盘
const persistStore = (): void => {
  try {
    const data = JSON.stringify(Object.fromEntries(memoryStore), null, 2);
    writeFileSync(storePath, data, "utf8");
  } catch (error) {
    serverLog.error("❌ 配置文件写入失败:", error);
  }
};

// 读取配置项，未设置时返回默认值
export const getStoreValue = <T>(key: string, defaultValue: T): T => {
  loadStore();
  const value = memoryStore.get(key);
  return value === undefined ? defaultValue : (value as T);
};

// 写入配置项并持久化
export const setStoreValue = (key: string, value: unknown): void => {
  loadStore();
  memoryStore.set(key, value);
  persistStore();
};
