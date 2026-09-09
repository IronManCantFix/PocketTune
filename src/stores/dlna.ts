// DLNA 局域网投送状态：设备列表、投送目标、投送状态与电视播放控制
import { defineStore } from "pinia";
import {
  dlnaDiscover,
  dlnaPlay,
  dlnaControl,
  dlnaStatus,
  type DlnaDeviceInfo,
  type DlnaTransportState,
} from "@/api/dlna";
import { useAudioManager } from "@/core/player/AudioManager";
import { useMusicStore, useStatusStore } from "@/stores";

interface DlnaState {
  /** 发现的设备列表 */
  devices: DlnaDeviceInfo[];
  /** 当前投送目标设备 id */
  activeUuid: string;
  /** 是否正在扫描设备 */
  discovering: boolean;
  /** 投送中的歌曲 id（用于切歌联动） */
  castingSongId: number | null;
  /** 投送中的歌曲名称 */
  castingSongName: string;
  /** 是否处于投送态 */
  isCasting: boolean;
  /** 电视是否正在播放 */
  tvPlaying: boolean;
  /** 轮询到的电视播放进度（秒） */
  pollPosition: number;
  /** 切歌联动进行中（防并发） */
  changingSong: boolean;
}

/**
 * 是否为可投送的媒体地址
 * 仅 http(s) 绝对地址或相对代理地址可投送
 */
const isCastableUrl = (url: string): boolean => {
  if (!url) return false;
  if (/^https?:\/\//i.test(url)) return true;
  // 相对同源代理地址（如 /api/unblock/proxy?url=...）
  if (url.startsWith("/")) return true;
  return false;
};

export const useDlnaStore = defineStore("dlna", {
  state: (): DlnaState => ({
    devices: [],
    activeUuid: "",
    discovering: false,
    castingSongId: null,
    castingSongName: "",
    isCasting: false,
    tvPlaying: false,
    pollPosition: 0,
    changingSong: false,
  }),
  getters: {
    /** 当前投送目标设备 */
    activeDevice(state): DlnaDeviceInfo | null {
      return state.devices.find((device) => device.uuid === state.activeUuid) ?? null;
    },
  },
  actions: {
    /**
     * 扫描局域网 DLNA 设备
     */
    async discover(): Promise<DlnaDeviceInfo[]> {
      this.discovering = true;
      try {
        const devices = await dlnaDiscover();
        this.devices = devices;
        // 若之前选中的设备仍在，保留；否则清空
        if (!devices.some((device) => device.uuid === this.activeUuid)) {
          this.activeUuid = "";
        }
        return devices;
      } finally {
        this.discovering = false;
      }
    },

    /**
     * 获取引擎当前播放地址（可投送时返回）
     * 引擎 src 为 HTMLMediaElement 属性，浏览器会把相对地址解析成绝对地址，
     * 这里转回相对地址，由后端按 DLNA_BASE_URL 决定电视拉流基址
     */
    getCurrentUrl(): string {
      const audioManager = useAudioManager();
      let url = audioManager.src;
      // 去掉页面 origin 前缀，还原为相对代理地址
      if (url.startsWith(window.location.origin)) {
        url = url.slice(window.location.origin.length);
      }
      return isCastableUrl(url) ? url : "";
    },

    /**
     * 投送当前歌曲到指定设备
     * @param uuid 目标设备 id
     */
    async castTo(uuid: string): Promise<boolean> {
      const musicStore = useMusicStore();
      const statusStore = useStatusStore();
      const currentSong = musicStore.playSong;
      const url = this.getCurrentUrl();
      if (!url) {
        window.$message.warning("当前歌曲暂不支持投送（本地文件或实时流）");
        return false;
      }
      try {
        this.activeUuid = uuid;
        await dlnaPlay(uuid, url, this.getCurrentCover());
        this.isCasting = true;
        this.tvPlaying = true;
        this.castingSongId = currentSong?.id ?? null;
        this.castingSongName = currentSong?.name ?? "";
        // 同步本地播放状态为播放中，让播放按钮图标与电视一致
        statusStore.playStatus = true;
        return true;
      } catch (error) {
        window.$message.error(`投送失败：${error instanceof Error ? error.message : "未知错误"}`);
        this.isCasting = false;
        return false;
      }
    },

    /**
     * 获取当前歌曲封面（完整尺寸，用于视频流合成）
     */
    getCurrentCover(): string {
      const musicStore = useMusicStore();
      const cover = musicStore.playSong?.coverSize?.l || musicStore.playSong?.cover || "";
      return cover;
    },

    /**
     * 投送指定地址到当前设备（切歌联动）
     * @param url 媒体地址
     * @param songId 歌曲 id
     * @param cover 封面地址（视频流合成用）
     */
    async castUrl(url: string, songId: number, cover?: string): Promise<boolean> {
      const musicStore = useMusicStore();
      const statusStore = useStatusStore();
      if (!this.isCasting || !this.activeUuid) return false;
      if (!isCastableUrl(url)) return false;
      try {
        await dlnaPlay(this.activeUuid, url, cover);
        this.castingSongId = songId ?? null;
        this.castingSongName = musicStore.playSong?.name ?? "";
        statusStore.playStatus = true;
        return true;
      } catch (error) {
        window.$message.error(
          `自动投送失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
        return false;
      }
    },

    /**
     * 切换电视播放/暂停
     */
    async togglePlay(): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      if (this.tvPlaying) {
        await dlnaControl(this.activeUuid, "pause");
        this.tvPlaying = false;
        useStatusStore().playStatus = false;
      } else {
        await dlnaControl(this.activeUuid, "resume");
        this.tvPlaying = true;
        useStatusStore().playStatus = true;
      }
    },

    /**
     * 暂停电视播放
     */
    async pause(): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      await dlnaControl(this.activeUuid, "pause");
      this.tvPlaying = false;
      useStatusStore().playStatus = false;
    },

    /**
     * 恢复电视播放
     */
    async resume(): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      await dlnaControl(this.activeUuid, "resume");
      this.tvPlaying = true;
      useStatusStore().playStatus = true;
    },

    /**
     * 电视进度跳转
     * @param seconds 目标时间（秒）
     */
    async seek(seconds: number): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      await dlnaControl(this.activeUuid, "seek", seconds);
      this.pollPosition = seconds;
      // 同步本地进度显示
      useStatusStore().currentTime = Math.floor(seconds * 1000);
    },

    /**
     * 断开投送：停止电视播放并复位本地状态
     */
    async disconnect(): Promise<void> {
      const statusStore = useStatusStore();
      if (this.activeUuid && this.isCasting) {
        try {
          await dlnaControl(this.activeUuid, "stop");
        } catch {
          // 忽略断开时的错误
        }
      }
      this.isCasting = false;
      this.tvPlaying = false;
      this.castingSongId = null;
      this.castingSongName = "";
      this.activeUuid = "";
      this.pollPosition = 0;
      statusStore.playStatus = false;
    },

    /**
     * 轮询电视播放状态与进度，回写本地展示
     */
    async syncPosition(): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      try {
        const state: DlnaTransportState | null = await dlnaStatus(this.activeUuid);
        if (state) {
          this.pollPosition = state.currentTime;
          this.tvPlaying = state.playing;
          // 回写本地进度，驱动进度条与歌词（仅投送态下覆盖）
          const statusStore = useStatusStore();
          if (state.currentTime > 0) {
            statusStore.currentTime = Math.floor(state.currentTime * 1000);
          }
          if (state.duration > 0) {
            statusStore.duration = Math.floor(state.duration * 1000);
          }
          if (this.tvPlaying !== statusStore.playStatus) {
            statusStore.playStatus = this.tvPlaying;
          }
        }
      } catch {
        // 忽略轮询失败
      }
    },

    /**
     * 等待引擎加载出可投送的新歌地址
     * 切歌后需要等网络解析完成（loadAndPlay 更新 src），轮询直到就绪或超时
     * @param timeout 超时（毫秒）
     */
    async waitForCastableUrl(timeout = 10000): Promise<string> {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const url = this.getCurrentUrl();
        if (url) return url;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return "";
    },

    /**
     * 处理切歌联动：若处于投送态，等待新歌地址就绪后自动投送
     * @param songId 新歌 id
     */
    async handleSongChange(songId: number): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      // 同一首歌不重复投送
      if (songId != null && this.castingSongId === songId) return;
      // 防止与上一次切换的投送并发
      if (this.changingSong) return;
      this.changingSong = true;
      try {
        // 切歌后引擎 src 需要重新加载，轮询等待新歌地址就绪
        const url = await this.waitForCastableUrl(10000);
        if (!url) {
          window.$message.warning("新歌地址加载超时，请手动断开后重新投送");
          return;
        }
        await this.castUrl(url, songId, this.getCurrentCover());
      } finally {
        this.changingSong = false;
      }
    },
  },
  persist: {
    key: "dlna-store",
    storage: localStorage,
    pick: ["activeUuid"],
  },
});
