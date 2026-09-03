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
    const cacheData: ListCacheData = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      type,
      id,
      detail,
      songs,
    };

    const key = getCacheKey(type, id);

    try {
      await listCacheDB.setItem(key, cacheData);
      console.log(`✅ List cache saved: ${key}`);
    } catch (error) {
      console.error(`❌ Failed to save list cache: ${key}`, error);
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
        console.log(`⚠️ Cache version mismatch: ${key}, removing old cache`);
        await removeCache(type, id);
        return null;
      }

      console.log(`✅ List cache loaded: ${key}`);
      return cacheData;
    } catch (error) {
      console.error(`❌ Failed to load list cache: ${key}`, error);
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
      const needsUpdate = cached.detail.updateTime !== latestDetail.updateTime;
      if (needsUpdate) {
        console.log(`🔄 Cache needs update: timestamp changed`);
        console.log(`   Old: ${cached.detail.updateTime}`);
        console.log(`   New: ${latestDetail.updateTime}`);
      } else {
        console.log(`✅ Cache is up to date (timestamp match)`);
      }
      return needsUpdate;
    }

    // 如果没有 updateTime，比较 count
    if (cached.detail.count !== latestDetail.count) {
      console.log(`🔄 Cache needs update: count changed`);
      return true;
    }

    if (cached.type === "album") {
      console.log(`✅ Album cache is up to date (count match)`);
    } else {
      console.log(`⚠️ No timestamp found, assuming up to date based on count`);
    }

    return false;
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
      console.log(`🗑️ List cache removed: ${key}`);
    } catch (error) {
      console.error(`❌ Failed to remove list cache: ${key}`, error);
    }
  };

  /**
   * 清除所有列表缓存
   */
  const clearAllCache = async (): Promise<void> => {
    try {
      await listCacheDB.clear();
      console.log(`🗑️ All list cache cleared`);
    } catch (error) {
      console.error(`❌ Failed to clear list cache`, error);
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
