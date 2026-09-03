import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { getPlaySongData } from "@/utils/format";
import { msToS } from "@/utils/time";
import { throttle } from "lodash-es";
import { usePlayerController } from "./PlayerController";

/**
 * 媒体会话管理器
 * web 平台使用 Navigator.mediaSession 提供系统级媒体控制
 */
class MediaSessionManager {
  private currentRate: number = 1;

  /**
   * 初始化媒体会话
   */
  public init() {
    const settingStore = useSettingStore();
    if (!settingStore.smtcOpen) return;

    const player = usePlayerController();
    const statusStore = useStatusStore();

    this.currentRate = statusStore.playRate;

    // Web API 初始化
    if ("mediaSession" in navigator) {
      const nav = navigator.mediaSession;
      nav.setActionHandler("play", () => player.play());
      nav.setActionHandler("pause", () => player.pause());
      nav.setActionHandler("previoustrack", () => player.nextOrPrev("prev"));
      nav.setActionHandler("nexttrack", () => player.nextOrPrev("next"));
      nav.setActionHandler("seekto", (e) => {
        if (e.seekTime) player.setSeek(e.seekTime * 1000);
      });
    }
  }

  /**
   * 更新元数据
   */
  public async updateMetadata() {
    if (!("mediaSession" in navigator)) return;
    const musicStore = useMusicStore();
    const song = getPlaySongData();
    if (!song) return;
    const metadata = this.buildMetadata(song);
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      artwork: this.buildArtwork(musicStore),
    });
  }

  /**
   * 构建元数据
   */
  private buildMetadata(song: ReturnType<typeof getPlaySongData>): {
    title: string;
    artist: string;
    album: string;
    coverUrl: string;
  } {
    const isRadio = song!.type === "radio";
    const musicStore = useMusicStore();

    return {
      title: song!.name,
      artist: isRadio
        ? song!.dj?.creator || "未知播客"
        : Array.isArray(song!.artists)
          ? song!.artists.map((a) => a.name).join("/")
          : String(song!.artists),
      album: isRadio
        ? song!.dj?.name || "未知播客"
        : typeof song!.album === "object"
          ? song!.album.name
          : String(song!.album),
      coverUrl: musicStore.getSongCover("xl") || musicStore.playSong.cover || "",
    };
  }

  /**
   * 构建专辑封面数组
   */
  private buildArtwork(musicStore: ReturnType<typeof useMusicStore>) {
    return [
      {
        src: musicStore.getSongCover("s") || musicStore.playSong.cover || "",
        sizes: "100x100",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("m") || musicStore.playSong.cover || "",
        sizes: "300x300",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("cover") || musicStore.playSong.cover || "",
        sizes: "512x512",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("l") || musicStore.playSong.cover || "",
        sizes: "1024x1024",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("xl") || musicStore.playSong.cover || "",
        sizes: "1920x1920",
        type: "image/jpeg",
      },
    ];
  }

  /**
   * 更新播放进度
   * @param duration 总时长
   * @param position 当前位置
   * @param immediate 是否立即同步，用于 Seek 操作
   */
  public updateState(duration: number, position: number, immediate: boolean = false) {
    const settingStore = useSettingStore();
    if (!settingStore.smtcOpen) return;

    // Seek 时跳过限流立即同步，避免进度跳变被丢弃
    if (immediate) {
      this.throttledUpdatePositionState.cancel();
    }
    this.throttledUpdatePositionState(duration, position);
  }

  /**
   * 更新播放速率
   */
  public updatePlaybackRate(rate: number) {
    this.currentRate = rate;
  }

  /**
   * 限流更新进度状态
   */
  private throttledUpdatePositionState = throttle((duration: number, position: number) => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setPositionState({
        duration: msToS(duration),
        position: msToS(position),
        playbackRate: this.currentRate,
      });
    }
  }, 1000);
}

export const mediaSessionManager = new MediaSessionManager();
