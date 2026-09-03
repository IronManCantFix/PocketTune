// @unblockneteasemusic/server 模块声明，CommonJS 无官方类型，主入口为 src/provider/match.js
declare module "@unblockneteasemusic/server" {
  /** UNM 匹配成功的音频数据 */
  export interface UnmAudioData {
    /** 文件大小，未知时为 0 */
    size: number;
    /** 码率，未知时为 null */
    br: number | null;
    /** 可播放地址 */
    url: string | null;
    /** 文件 MD5，未知时为 null */
    md5: string | null;
    /** 命中的音源名 */
    source: string;
  }

  /** 按音源列表匹配歌曲可播放地址，全部音源失败时抛出异常 */
  function match(id: number | string, source?: string[], data?: object): Promise<UnmAudioData>;

  export default match;
}
