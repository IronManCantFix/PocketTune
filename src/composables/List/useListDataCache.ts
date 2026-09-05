import { toRaw } from "vue";
import { cloneDeep } from "lodash-es";
import type { CoverType, SongType } from "@/types/main";
import localforage from "localforage";

/**
 * 列表类型
 */
export type ListType = "playlist" | "album" | "radio";

/**
 * 列表缓存数据结构
 */
export interface ListCacheData {
  /** 缓存版本号 */
  version: number;
  /** 缓存时间戳 */
  timestamp: number;
  /** 列表类型 */
  type: ListType;
  /** 列表 ID */
  id: number;
  /** 列表详情 */
  detail: CoverType;
  /** 歌曲列表 */
  songs: SongType[];
}

/** 缓存版本号 */
const CACHE_VERSION = 2; // Bump version due to logic change

// 列表缓存 DB
const listCacheDB = localforage.createInstance({
  name: "list-data",
  description: "Cached data of the list",
  storeName: "list",
});

/**
 * 列表数据缓存组合式函数
 * 提供列表缓存的读写功能
 */
export const useListDataCache = () => {
  /**
   * 生成缓存 key
   * @param type 列表类型
   * @param id 列表 ID
   */
  const getCacheKey = (type: ListType, id: number): string => {
    return `${type}-${id}.json`;
  };

  /**
   * 保存缓存
   * @param type 列表类型
   * @param id 列表 ID
   * @param detail 列表详情数据
   * @param songs 歌曲列表
   */
  const saveCache = async (
    type: ListType,
    id: number,
    detail: CoverType,
    songs: SongType[],
  ): Promise<void> => {
    // 解除 Vue 响应式代理并深拷贝为普通对象，避免 IndexedDB 写入时结构化克隆失败
    const cacheData: ListCacheData = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      type,
      id,
      detail: cloneDeep(toRaw(detail)),
      songs: cloneDeep(toRaw(songs)),
    };

    const key = getCacheKey(type, id);

    try {
      await listCacheDB.setItem(key, cacheData);
    } catch (error) {
      console.error(`Failed to save list cache: ${key}`, error);
    }
  };

  /**
   * 加载缓存
   * @param type 列表类型
   * @param id 列表 ID
   * @returns 缓存数据，如果不存在或已过期则返回 null
   */
  const loadCache = async (type: ListType, id: number): Promise<ListCacheData | null> => {
    const key = getCacheKey(type, id);

    try {
      const cacheData = (await listCacheDB.getItem(key)) as ListCacheData | null;
      if (!cacheData) {
        return null;
      }

      // 检查版本
      if (cacheData.version !== CACHE_VERSION) {
        await removeCache(type, id);
        return null;
      }

      return cacheData;
    } catch (error) {
      console.error(`Failed to load list cache: ${key}`, error);
      return null;
    }
  };

  /**
   * 检查缓存是否需要更新
   * 通过比较 updateTime 来判断
   * @param cached 缓存数据
   * @param latestDetail 新获取的详情数据
   * @returns 是否需要更新
   */
  const checkNeedsUpdate = (cached: ListCacheData, latestDetail: CoverType): boolean => {
    // 如果有 updateTime，则比较
    if (cached.detail.updateTime && latestDetail.updateTime) {
      return cached.detail.updateTime !== latestDetail.updateTime;
    }

    // 如果没有 updateTime，比较 count
    return cached.detail.count !== latestDetail.count;
  };

  /**
   * 删除缓存
   * @param type 列表类型
   * @param id 列表 ID
   */
  const removeCache = async (type: ListType, id: number): Promise<void> => {
    const key = getCacheKey(type, id);

    try {
      await listCacheDB.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove list cache: ${key}`, error);
    }
  };

  /**
   * 清除所有列表缓存
   */
  const clearAllCache = async (): Promise<void> => {
    try {
      await listCacheDB.clear();
    } catch (error) {
      console.error(`Failed to clear list cache`, error);
    }
  };

  return {
    getCacheKey,
    saveCache,
    loadCache,
    checkNeedsUpdate,
    removeCache,
    clearAllCache,
  };
};
