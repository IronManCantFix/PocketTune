// DLNA 局域网投送状态：设备列表、投送目标、投送状态与电视播放控制
import { watch } from "vue";
import { defineStore } from "pinia";
import {
  dlnaDiscover,
  dlnaPlay,
  dlnaTaskStatus,
  dlnaTaskCancel,
  dlnaControl,
  dlnaStatus,
  type DlnaDeviceInfo,
  type DlnaTransportState,
  type DlnaLyricLine,
} from "@/api/dlna";
import { useAudioManager } from "@/core/player/AudioManager";
import { usePlayerController } from "@/core/player/PlayerController";
import { useMusicStore, useStatusStore } from "@/stores";

// 通用延时
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 轮询防重入标记：上一轮请求未结束时跳过本轮，避免超时挂起时请求堆积
let syncInFlight = false;

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
  /** 投送任务进行中（封面视频合成耗时较长，UI 显示加载态） */
  castingPending: boolean;
  /** 电视当前音量（0-100，设备不支持时为 null） */
  tvVolume: number | null;
  /** 电视是否静音（设备不支持时为 null） */
  tvMuted: boolean | null;
  /** 进度条拖动中（轮询跳过回写，避免滑块回跳） */
  sliderDragging: boolean;
  /** 投送开始时本地是否在播放（断开投送时恢复用） */
  castStartedLocalPlaying: boolean;
  /** 最近一次手动调音量时间（轮询音量回跳保护） */
  lastVolumeChangeAt: number;
  /** 轮询连续失败次数（超过阈值视为电视离线并自动退出投送） */
  pollFailCount: number;
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
    castingPending: false,
    tvVolume: null,
    tvMuted: null,
    sliderDragging: false,
    castStartedLocalPlaying: false,
    lastVolumeChangeAt: 0,
    pollFailCount: 0,
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
        // 若之前选中的设备仍在，保留；否则清空并退出投送态（避免投送悬挂）
        if (!devices.some((device) => device.uuid === this.activeUuid)) {
          if (this.activeUuid) {
            const uuid = this.activeUuid;
            const wasCasting = this.isCasting;
            this.activeUuid = "";
            if (wasCasting) {
              window.$message.warning("投送设备已离线，已退出投送");
              void this.disconnect(uuid);
            }
          }
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
     * 投送静音：本地引擎以音量 0 镜像电视播放
     * 不使用 pause 的原因：pause 会与播放引擎的 play() promise 竞态产生 AbortError，
     * 且静音播放让本地进度/歌词与电视天然同步（音量操作仅作用于引擎，不改用户音量设置）
     */
    muteLocalForCast(): void {
      const audioManager = useAudioManager();
      audioManager.setVolume(0);
      // 本地未播放时以静音方式启动，保证进度跟随电视
      void audioManager.resume().catch(() => undefined);
      useStatusStore().playStatus = true;
    },

    /**
     * 等待投送任务完成（封面视频合成耗时长，轮询后端任务状态）
     * @param taskId 投送任务 id（0 表示旧后端，视为直接成功）
     * @param timeout 轮询超时（毫秒）
     * @param targetUuid 超时兜底停止的目标设备（缺省用当前投送目标）
     */
    async awaitTaskResult(taskId: number, timeout = 120000, targetUuid?: string): Promise<boolean> {
      // 兼容旧后端：未返回任务 id 时视为同步成功
      if (!taskId) return true;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const task = await dlnaTaskStatus(taskId).catch(() => null);
        if (!task) {
          // 任务不存在：后端可能已重启，保守视为失败
          window.$message.error("投送任务已失效，请重新扫描设备后重试");
          return false;
        }
        if (task.state === "done") return true;
        if (task.state === "error") {
          window.$message.error(`投送失败：${task.message || "未知错误"}`);
          return false;
        }
        if (task.state === "cancelled") {
          window.$message.warning("投送已取消");
          return false;
        }
        // pending / running：任务进行中，继续轮询
        await sleep(1000);
      }
      window.$message.warning("投送超时，请确认电视网络正常后重试");
      // 取消服务端任务并停止电视，防止任务迟到成功导致手机与电视双出声
      await dlnaTaskCancel(taskId).catch(() => undefined);
      const stopTarget = targetUuid ?? this.activeUuid;
      if (stopTarget) await dlnaControl(stopTarget, "stop").catch(() => undefined);
      return false;
    },

    /**
     * 等待歌词加载完成（切歌后 playSong 已切换但歌词异步加载中，避免烧录旧歌词）
     * @param timeout 超时（毫秒），超时后按当前歌词继续（不阻断投送）
     */
    async waitForLyricReady(timeout = 8000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (!useStatusStore().lyricLoading) return;
        await sleep(200);
      }
    },

    /**
     * 投送当前歌曲到指定设备
     * @param uuid 目标设备 id
     */
    async castTo(uuid: string): Promise<boolean> {
      const musicStore = useMusicStore();
      const currentSong = musicStore.playSong;
      const url = this.getCurrentUrl();
      if (!url) {
        window.$message.warning("当前歌曲暂不支持投送（本地文件或实时流）");
        return false;
      }
      // 记录投送前本地播放状态（断开投送时恢复用），并保留旧目标用于失败回滚
      const prevUuid = this.activeUuid;
      const prevCasting = this.isCasting;
      const wasLocalPlaying = useStatusStore().playStatus;
      this.activeUuid = uuid;
      this.castingPending = true;
      try {
        // 等待歌词就绪，避免投送时烧录旧歌词
        await this.waitForLyricReady();
        const taskId = await dlnaPlay(uuid, url, this.getCurrentCover(), this.getCastMeta());
        // 任务提交成功即静音本地（封面合成耗时长，避免投送期间手机继续出声）
        useAudioManager().setVolume(0);
        // 显式传入本次投送目标，回滚前锁定，避免超时兜底停止到错误设备
        const ok = await this.awaitTaskResult(taskId, 120000, uuid);
        if (!ok) {
          // 投送失败：回滚到原目标（原未投送时恢复未投送态），并恢复本地播放
          this.activeUuid = prevUuid;
          if (!prevCasting) this.isCasting = false;
          if (wasLocalPlaying) {
            await usePlayerController().play();
          }
          return false;
        }
        this.isCasting = true;
        this.tvPlaying = true;
        this.castingSongId = currentSong?.id ?? null;
        this.castingSongName = currentSong?.name ?? "";
        this.castStartedLocalPlaying = wasLocalPlaying;
        // 投送成功：本地保持静音，由电视独占出声
        this.muteLocalForCast();
        return true;
      } catch (error) {
        window.$message.error(`投送失败：${error instanceof Error ? error.message : "未知错误"}`);
        this.activeUuid = prevUuid;
        if (!prevCasting) this.isCasting = false;
        // 异常中断时同样恢复本地播放（投送前在播放时）
        if (wasLocalPlaying) {
          await usePlayerController().play();
        }
        return false;
      } finally {
        this.castingPending = false;
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
     * 收集投送元数据（歌名/歌手/歌词，封面视频烧录字幕用；songId 供服务端缓存 key）
     */
    getCastMeta(): { title?: string; artist?: string; lyrics?: DlnaLyricLine[]; songId?: number } {
      const musicStore = useMusicStore();
      const song = musicStore.playSong;
      const artistName = Array.isArray(song?.artists)
        ? song.artists.map((a) => a.name).join(" / ")
        : (song?.artists as string) || "";
      // 歌词行精简转换（仅保留字幕所需字段）
      const lines = musicStore.songLyric?.lrcData ?? [];
      const lyrics: DlnaLyricLine[] = lines
        .filter((line) => line.words?.length)
        .map((line) => ({
          startTime: line.startTime,
          endTime: line.endTime,
          words: line.words.map((w) => w.word).join(""),
          translatedLyric: line.translatedLyric || undefined,
        }));
      return {
        title: song?.name,
        artist: artistName,
        lyrics: lyrics.length > 0 ? lyrics : undefined,
        songId: song?.id,
      };
    },

    /**
     * 投送指定地址到当前设备（切歌联动）
     * @param url 媒体地址
     * @param songId 歌曲 id
     * @param cover 封面地址（视频流合成用）
     */
    async castUrl(url: string, songId: number, cover?: string): Promise<boolean> {
      const musicStore = useMusicStore();
      if (!this.isCasting || !this.activeUuid) return false;
      if (!isCastableUrl(url)) return false;
      this.castingPending = true;
      try {
        // 切歌投送同样等待歌词就绪，避免烧录上一首歌的歌词
        await this.waitForLyricReady();
        const taskId = await dlnaPlay(this.activeUuid, url, cover, this.getCastMeta());
        const ok = await this.awaitTaskResult(taskId, 120000, this.activeUuid);
        if (!ok) return false;
        this.castingSongId = songId ?? null;
        this.castingSongName = musicStore.playSong?.name ?? "";
        // 切歌投送成功：同样立即暂停本地，防止新歌在手机出声
        this.muteLocalForCast();
        return true;
      } catch {
        // 失败提示由调用方负责，此处静默返回 false
        return false;
      } finally {
        this.castingPending = false;
      }
    },

    /**
     * 切换电视播放/暂停
     */
    async togglePlay(): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      const audioManager = useAudioManager();
      if (this.tvPlaying) {
        // 本地镜像：电视暂停时本地引擎同步暂停（保持两端进度一致）
        audioManager.pause();
        await dlnaControl(this.activeUuid, "pause");
        this.tvPlaying = false;
        useStatusStore().playStatus = false;
      } else {
        audioManager.resume();
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
      // 同步本地进度显示，并让本地引擎同步跳转（保持两端一致）
      useStatusStore().currentTime = Math.floor(seconds * 1000);
      usePlayerController().setSeek(Math.floor(seconds * 1000));
    },

    /**
     * 设置电视音量（投送态下音量条转发到电视）
     * @param volume01 音量（0-1）
     */
    async setVolume(volume01: number): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      const vol01 = Math.max(0, Math.min(volume01, 1));
      useStatusStore().playVolume = vol01;
      this.tvVolume = Math.round(vol01 * 100);
      this.lastVolumeChangeAt = Date.now();
      try {
        await dlnaControl(this.activeUuid, "volume", Math.round(vol01 * 100));
      } catch {
        // 电视音量设置失败不打断本地操作
      }
    },

    /**
     * 切换电视静音（投送态下静音按钮转发到电视）
     */
    async toggleMute(): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      const statusStore = useStatusStore();
      const willMute = !(this.tvMuted ?? false);
      try {
        await dlnaControl(this.activeUuid, "mute", willMute ? 1 : 0);
        this.tvMuted = willMute;
        // 设置成功后才同步本地展示（音量图标/百分比跟随）
        if (willMute) {
          statusStore.playVolumeMute = statusStore.playVolume;
          statusStore.playVolume = 0;
        } else {
          statusStore.playVolume = statusStore.playVolumeMute || 0.7;
        }
      } catch {
        // 设置失败不动本地状态，避免与电视实际状态不一致
      }
    },

    /**
     * 断开投送：停止电视播放、复位本地状态，并按投送前状态恢复本地播放
     * @param targetUuid 指定断开的设备（discover 扫描丢失设备时传入）
     * @param resumeLocal 是否恢复本地播放（默认恢复）
     */
    async disconnect(targetUuid?: string, resumeLocal = true): Promise<void> {
      const statusStore = useStatusStore();
      const wasLocalPlaying = this.castStartedLocalPlaying;
      const tvPosition = this.pollPosition;
      const uuid = targetUuid ?? this.activeUuid;
      if (uuid && this.isCasting) {
        try {
          await dlnaControl(uuid, "stop");
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
      this.castingPending = false;
      this.tvVolume = null;
      this.tvMuted = null;
      this.pollFailCount = 0;
      // 恢复本地音量（投送期间本地引擎音量被置 0）
      useAudioManager().setVolume(statusStore.playVolume);
      statusStore.playStatus = false;
      // 恢复本地播放（投送前本地在播放时），并按电视进度续播
      if (resumeLocal && wasLocalPlaying) {
        try {
          const player = usePlayerController();
          await player.play();
          if (tvPosition > 0) {
            player.setSeek(Math.floor(tvPosition * 1000));
          }
        } catch {
          // 恢复失败仅记录，不影响断开结果
        }
      } else if (tvPosition > 0) {
        // 不恢复播放时把引擎对齐到电视进度，避免 UI 进度与引擎位置不一致
        usePlayerController().setSeek(Math.floor(tvPosition * 1000));
      }
    },

    /**
     * 轮询失败处理：连续多次失败视为电视已离线，自动退出投送，避免轮询空转
     */
    async handlePollFailure(): Promise<void> {
      this.pollFailCount += 1;
      if (this.pollFailCount >= 5) {
        this.pollFailCount = 0;
        window.$message.warning("电视连接已断开，已退出投送");
        await this.disconnect();
      }
    },

    /**
     * 轮询电视播放状态与进度，回写本地展示
     */
    async syncPosition(): Promise<void> {
      if (!this.isCasting || !this.activeUuid) return;
      // 防重入：上一轮请求未结束时跳过本轮，避免请求堆积
      if (syncInFlight) return;
      syncInFlight = true;
      try {
        const state: DlnaTransportState | null = await dlnaStatus(this.activeUuid);
        if (state) {
          this.pollFailCount = 0;
          this.pollPosition = state.currentTime;
          this.tvPlaying = state.playing;
          const statusStore = useStatusStore();
          // 本地以静音方式镜像电视播放，进度/歌词由本地引擎天然驱动，无需回写
          // 电视端状态变化（用户用电视遥控暂停/恢复）时镜像到本地引擎
          if (state.playing !== statusStore.playStatus) {
            statusStore.playStatus = state.playing;
            try {
              if (state.playing) {
                void useAudioManager().resume();
              } else {
                useAudioManager().pause();
              }
            } catch {
              // 镜像失败忽略，下轮轮询继续
            }
          }
          // 同步电视音量/静音到本地展示（用户刚调过音量时短暂跳过，防回跳）
          if (state.volume != null) {
            this.tvVolume = state.volume;
            if (Date.now() - this.lastVolumeChangeAt > 2000) {
              const vol01 = state.volume / 100;
              if (Math.abs(useStatusStore().playVolume - vol01) > 0.01) {
                useStatusStore().playVolume = vol01;
              }
            }
          }
          if (state.muted != null) {
            this.tvMuted = state.muted;
          }
        } else {
          // 超时/网络错误时 request 会以空数据 resolve（不抛错），同样计入失败
          await this.handlePollFailure();
        }
      } catch {
        await this.handlePollFailure();
      } finally {
        syncInFlight = false;
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
        await sleep(300);
      }
      return "";
    },

    /**
     * 处理切歌联动：若处于投送态，等待新歌地址就绪后自动投送
     * 新歌不可投送（本地文件/实时流/加载失败）时断开投送并恢复本地播放，避免电视与前端脱节
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
        // 投送态下切歌：立即静音本地，避免新歌加载完成后在手机出声
        useAudioManager().setVolume(0);
        // 切歌后引擎 src 需要重新加载，轮询等待新歌地址就绪
        const url = await this.waitForCastableUrl(10000);
        if (!url) {
          // 新歌不可投送：断开投送并恢复本地播放，避免电视与前端状态脱节
          window.$message.warning("当前歌曲不支持投送，已断开投送并切回本地播放");
          // 清空电视进度，避免断开续播把旧歌进度 seek 到新歌上
          this.pollPosition = 0;
          await this.disconnect();
          return;
        }
        const ok = await this.castUrl(url, songId, this.getCurrentCover());
        if (!ok) {
          // 自动投送失败：断开投送并恢复本地播放，避免电视与前端状态脱节
          window.$message.warning("投送切歌失败，已断开投送并切回本地播放");
          // 清空电视进度，避免断开续播把旧歌进度 seek 到新歌上
          this.pollPosition = 0;
          await this.disconnect();
        }
      } finally {
        this.changingSong = false;
      }
    },
  },
  persist: {
    key: "dlna-store",
    storage: localStorage,
    // 持久化投送会话关键状态：刷新后恢复投送态（设备列表会重新扫描/探测）
    pick: [
      "activeUuid",
      "isCasting",
      "castingSongId",
      "castingSongName",
      "castStartedLocalPlaying",
    ],
  },
});

// 投送全局联动是否已初始化（模块级单例，与组件挂载无关）
let watchersReady = false;

// 投送态轮询定时器（模块级单例：多个 CastControl 实例共享，避免重复轮询电视）
let pollTimer: number | null = null;

// 启动投送态轮询（已有定时器时直接返回）
const startPolling = (): void => {
  if (pollTimer !== null) return;
  const store = useDlnaStore();
  pollTimer = window.setInterval(() => void store.syncPosition(), 1500);
};

// 停止投送态轮询
const stopPolling = (): void => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};

/**
 * 注册投送全局联动（进程级单例，由任意 CastControl 实例挂载时触发一次）
 * 1. 切歌联动：任何路径切歌（点播/上一首/下一首/随机/FM）都自动投送到电视
 * 2. 刷新后恢复投送会话：探测电视连接，不可达时自动退出投送态
 * 注：投送静音采用「本地音量置 0 镜像播放」策略（见 muteLocalForCast），不拦截播放事件
 */
export const setupDlnaWatchers = (): void => {
  if (watchersReady) return;
  watchersReady = true;

  const store = useDlnaStore();
  const musicStore = useMusicStore();

  // 切歌联动（单例 watch，覆盖所有切歌入口）
  watch(
    () => musicStore.playSong.id,
    (songId, prev) => {
      if (!store.isCasting) return;
      if (songId == null || prev == null || songId === prev) return;
      void store.handleSongChange(songId);
    },
  );

  // 投送态变化联动轮询启停（模块级单例定时器，与组件生命周期解耦）
  watch(
    () => store.isCasting,
    (casting) => {
      if (casting) {
        startPolling();
      } else {
        stopPolling();
      }
    },
  );

  // 刷新后恢复投送会话：设备列表已丢失，先探测电视连接状态
  if (store.isCasting && store.activeUuid) {
    // 已恢复投送态：直接启动轮询（watch 对持久化恢复的初始值不触发）
    startPolling();
    void dlnaStatus(store.activeUuid)
      .then((state) => {
        // 电视不可达（后端重启/电视关机）时自动退出投送态，避免本地播放被误拦截
        if (!state) {
          window.$message.warning("电视连接已断开，已退出投送");
          void store.disconnect();
        }
      })
      .catch(() => {
        window.$message.warning("电视连接已断开，已退出投送");
        void store.disconnect();
      });
  }
};
