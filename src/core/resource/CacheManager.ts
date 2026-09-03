/**
 * 缓存资源类型
 * - music: 音乐缓存
 * - lyrics: 歌词缓存
 * - local-data: 本地音乐数据缓存
 * - list-data: 列表数据缓存（歌单/专辑/电台）
 */
export type CacheResourceType = "music" | "lyrics" | "local-data" | "list-data";

/**
 * 缓存文件列表项信息
 */
export type CacheListItem = {
  /** 缓存 key（文件名或相对路径） */
  key: string;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间（毫秒时间戳） */
  mtime: number;
};

/**
 * 缓存操作统一返回结构
 * @template T data 字段的数据类型
 */
export type CacheResult<T = any> = {
  /** 是否成功 */
  success: boolean;
  /** 返回数据 */
  data?: T;
  /** 错误信息（失败时） */
  message?: string;
};

/**
 * 可写入缓存的数据类型
 */
type CacheWriteData = Uint8Array | ArrayBuffer | string;

/**
 * 缓存管理器
 * web 环境暂不支持文件缓存，所有操作返回失败结果
 */
class CacheManager {
  /**
   * 返回统一的"不支持"结果
   */
  private unsupported<T>(): Promise<CacheResult<T>> {
    return Promise.resolve({
      success: false,
      message: "当前环境不支持缓存",
    });
  }

  /**
   * 获取指定类型缓存下的文件列表
   * @param _type 缓存资源类型
   */
  list(_type: CacheResourceType): Promise<CacheResult<CacheListItem[]>> {
    return this.unsupported();
  }

  /**
   * 读取指定缓存内容
   * @param _type 缓存资源类型
   * @param _key 缓存 key（文件名或相对路径）
   */
  get(_type: CacheResourceType, _key: string): Promise<CacheResult<Uint8Array>> {
    return this.unsupported();
  }

  /**
   * 写入或更新缓存内容
   * @param _type 缓存资源类型
   * @param _key 缓存 key（文件名或相对路径）
   * @param _data 要写入的数据
   */
  set(_type: CacheResourceType, _key: string, _data: CacheWriteData): Promise<CacheResult<null>> {
    return this.unsupported();
  }

  /**
   * 删除单个缓存文件
   * @param _type 缓存资源类型
   * @param _key 缓存 key（文件名或相对路径）
   */
  remove(_type: CacheResourceType, _key: string): Promise<CacheResult<null>> {
    return this.unsupported();
  }

  /**
   * 清空指定类型的缓存目录
   * @param _type 缓存资源类型
   */
  clear(_type: CacheResourceType): Promise<CacheResult<null>> {
    return this.unsupported();
  }

  /**
   * 清空所有缓存
   */
  clearAll(): Promise<CacheResult<null>> {
    return this.unsupported();
  }

  /**
   * 获取所有缓存类型的总大小（字节）
   */
  getSize(): Promise<CacheResult<number>> {
    return this.unsupported();
  }
}

let cacheManager: CacheManager | null = null;

/**
 * 获取全局单例的缓存管理器
 * @returns CacheManager 实例
 */
export const useCacheManager = (): CacheManager => {
  if (!cacheManager) cacheManager = new CacheManager();
  return cacheManager;
};
