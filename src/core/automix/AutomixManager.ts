import { AudioScheduler } from "./AudioScheduler";
import { getSharedAudioContext } from "./SharedAudioContext";
import { useAudioManager } from "../player/AudioManager";
import { usePlayerController } from "../player/PlayerController";
import { useDataStore, useSettingStore, useStatusStore } from "@/stores";
import type { AudioAnalysis, AutomixPlan, AutomixState } from "@/types/audio/automix";
import type { SongType } from "@/types/main";
import { msToTime } from "@/utils/time";

/** 日志时间戳映射最大条目数，防止无限增长 */
const MAX_LOG_TIMESTAMPS = 100;

/**
 * 自动混音（Automix）管理器
 * 职责：独立负责自动混音的预分析、智能调度、BPM对齐与无缝切歌逻辑
 */
export class AutomixManager {
  /** 下一首歌的完整音频特征分析数据（web 环境暂无分析来源，恒为 null） */
  public nextAnalysis: AudioAnalysis | null = null;
  /** 下一首歌分析所使用的 Key */
  public nextAnalysisKey: string | null = null;
  /** 下一首歌分析的深度："none"(未分析) | "head"(仅头部分析) | "full"(完整分析) */
  public nextAnalysisKind: "none" | "head" | "full" = "none";

  /** 当前由于 Automix 引发的音量增益（通常在自动混音过程中会动态下降或拉升） */
  public automixGain = 1.0;
  /** 当前的自动混音器状态：IDLE(空闲) -> MONITORING(持续监控) -> SCHEDULED(已调度) -> TRANSITIONING(正在过渡) */
  public automixState: AutomixState = "IDLE";
  /** 底层基于 AudioContext 精确定时的独立调度器实例 */
  public automixScheduler: AudioScheduler | null = null;
  /** 调度器编排任务组的唯一标识 ID */
  public automixScheduleGroupId: string | null = null;
  /** 下一次计划触发混音过渡时，对应的 AudioContext 内部时钟绝对时间点 */
  public automixScheduledCtxTime: number | null = null;
  /** 触发混音时的请求 Token 标识，用于校验是否发生过外部干预（比如用户手动快进） */
  public automixScheduledToken: number | null = null;
  /** 下一次将要被播放的新一首的 ID，用于调度后验证 */
  public automixScheduledNextId: number | string | null = null;
  /** 限制日志频率的时间戳映射字典 */
  public automixLogTimestamps = new Map<string, number>();

  /**
   * 重置下一首歌的所有分析缓存和状态提案
   * （通常在手动切歌、歌曲结束重播、或者关闭混音时调用）
   */
  public resetNextAnalysisCache() {
    this.nextAnalysis = null;
    this.nextAnalysisKey = null;
    this.nextAnalysisKind = "none";
    this.automixLogTimestamps.clear();
    this.automixGain = 1.0;
  }

  /**
   * 将秒级时间转换为可读的 --:-- 格式的字符串
   * @param seconds 格式化的秒数（如 123.4）
   * @returns "--:--" 或 "02:03"
   */
  private formatAutomixTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return "--:--";
    return msToTime(Math.max(0, Math.round(seconds * 1000)));
  }

  /**
   * 根据 BPM 自动将时间锚点对齐到最近的节拍或小节上
   * 这有助于混音时鼓点踩稳，防止相位差
   * @param time 当前目标时间 (秒)
   * @param bpm 歌曲速度 (Beats per minute)
   * @param firstBeat 第一拍的偏移量起始时间 (秒)
   * @param snapToBar 是否对齐到整个小节 (默认 4 拍一个小节)
   * @returns 对齐后的修正时间 (秒)
   */
  public snapToBeat(
    time: number,
    bpm: number,
    firstBeat: number,
    snapToBar: boolean = true,
  ): number {
    if (bpm <= 0) return time;
    const spb = 60 / bpm;
    const interval = snapToBar ? spb * 4 : spb;
    const offset = time - firstBeat;
    const units = Math.round(offset / interval);
    return firstBeat + units * interval;
  }

  /**
   * 确保为 Automix 缓存并准备音频源
   * web 环境暂无本地音乐缓存，直接返回原音频源
   * @param song 歌曲对象
   * @param audioSourceUrl 音频源 URL
   * @param quality 音频质量
   * @returns 缓存后的音频源 URL
   */
  public async ensureAutomixAudioSource(
    _song: SongType,
    audioSourceUrl: string,
    _quality?: string,
  ): Promise<string> {
    // web 环境暂不支持本地音乐缓存
    return audioSourceUrl;
  }

  /**
   * 获取并执行当前音频源的 Automix 特征分析
   * web 环境暂无离线特征分析能力，返回空结果，Automix 将降级为基于时长的淡入淡出
   * @param analysisKey 音频源的分析 Key（通常是歌曲的本地文件路径）
   * @param analysisMode 分析模式：
   *   - "none": 不执行分析
   *   - "head": 只分析开头部分（用于 Smart Cut 推荐）
   *   - "full": 分析完整音频（用于 BPM 对齐和混音推荐）
   * @returns 包含分析结果和实际分析模式的对象
   */
  public async fetchAudioAnalysis(
    _analysisKey: string | null,
    _analysisMode: "none" | "head" | "full",
  ): Promise<{ analysis: AudioAnalysis | null; analysisKind: "none" | "head" | "full" }> {
    // web 环境暂无离线特征分析能力
    return { analysis: null, analysisKind: "none" };
  }

  /**
   * 计算 Automix 初始混音参数
   * 包括基于 Smart Cut 的 startSeek 和基于 BPM 对齐的 initialRate
   * @param analysis 当前音频分析结果
   * @param lastAnalysis 上一首音频分析结果
   * @param options 播放选项
   * @param originalSeek 用户给定的初始 seek
   */
  public calculateInitialAutomixParameters(
    analysis: AudioAnalysis | null,
    lastAnalysis: AudioAnalysis | null,
    options: { crossfade?: boolean },
    originalSeek: number = 0,
  ): { startSeek: number; initialRate: number } {
    let startSeek = originalSeek;
    let initialRate = 1.0;
    if (analysis) {
      if (analysis.fade_in_pos && startSeek === 0) {
        const cutIn = analysis.cut_in_pos ?? analysis.fade_in_pos;
        startSeek = Math.max(startSeek, cutIn * 1000);
        console.log(`✨ [Automix] Smart Cut Start: ${msToTime(cutIn * 1000)}`);
      }
      if (options.crossfade && lastAnalysis && lastAnalysis.bpm && analysis.bpm) {
        const bpmA = lastAnalysis.bpm;
        const bpmB = analysis.bpm;
        const confidenceA = lastAnalysis.bpm_confidence ?? 0;
        const confidenceB = analysis.bpm_confidence ?? 0;
        // 只有当两首歌的 BPM 匹配度在 3% 以内时才进行速度对齐
        if (confidenceA > 0.4 && confidenceB > 0.4) {
          const ratio = bpmA / bpmB;
          if (ratio >= 0.97 && ratio <= 1.03) {
            initialRate = ratio;
            console.log(
              `✨ [Automix] BPM Align: ${bpmA.toFixed(1)} -> ${bpmB.toFixed(1)} (Rate: ${ratio.toFixed(4)})`,
            );
          }
        }
      }
    }
    return { startSeek, initialRate };
  }

  /**
   * 确保（并提前发起）下一首歌乃至当前歌曲未完备的底层音频离线特征分析
   * web 环境暂无离线特征分析能力，此方法为空操作
   */
  public ensureAutomixAnalysisReady(): void {
    // web 环境暂无离线特征分析能力，跳过预分析
  }

  /**
   * 记录受到节流保护的 Automix 专用日志
   * 防止在 `timeupdate` 或 `tick` 中高频触发控制台打印导致性能下降或刷屏
   * @param level 日志等级
   * @param key 限频缓存使用的局部标识
   * @param message 打印的文案
   * @param intervalMs 多少毫秒内不再重复打印（默认 5 秒）
   * @param detail 需要输出的对象详情
   */
  public automixLog(
    level: "log" | "warn",
    key: string,
    message: string,
    intervalMs: number = 5000,
    detail?: unknown,
  ): void {
    const playerController = usePlayerController();
    const now = Date.now();
    const scopedKey = `${playerController.currentRequestToken}:${key}`;
    const lastAt = this.automixLogTimestamps.get(scopedKey) ?? 0;
    if (intervalMs > 0 && now - lastAt < intervalMs) return;
    this.automixLogTimestamps.set(scopedKey, now);
    // 清理过期条目，只保留最近 N 条
    if (this.automixLogTimestamps.size > MAX_LOG_TIMESTAMPS) {
      const entries = [...this.automixLogTimestamps.entries()];
      const toDelete = entries.slice(0, entries.length - MAX_LOG_TIMESTAMPS);
      for (const [key] of toDelete) {
        this.automixLogTimestamps.delete(key);
      }
    }
    if (level === "warn") {
      if (detail === undefined) console.warn(message);
      else console.warn(message, detail);
      return;
    }
    if (detail === undefined) console.log(message);
    else console.log(message, detail);
  }

  /**
   * 被 PlayerController 进度条回调 `onTimeUpdate` 定期调用
   * 负责监控自动混音的整体生命周期开启，以及激活底层精确定时器 `AudioScheduler`
   */
  public updateAutomixMonitoring(): void {
    const playerController = usePlayerController();
    const audioManager = useAudioManager();
    const settingStore = useSettingStore();
    const statusStore = useStatusStore();

    if (
      !settingStore.enableAutomix ||
      audioManager.paused ||
      playerController.isTransitioning ||
      statusStore.personalFmMode
    ) {
      if (this.automixState !== "IDLE") this.resetAutomixScheduling("IDLE");
      return;
    }

    if (this.automixState === "IDLE") {
      this.automixState = "MONITORING";
    }

    this.ensureAutomixAnalysisReady();

    if (this.automixState === "MONITORING") {
      this.ensureAutomixScheduler();
    }
  }

  /**
   * 初始化并启动内部基于 Web Audio Context 的高精度底层时钟
   * 弥补主线程 RequestAnimationFrame 容易由于后台停顿或性能压力造成的丢帧、延误
   */
  public ensureAutomixScheduler(): void {
    if (this.automixScheduler) return;
    const audioContext = getSharedAudioContext();
    this.automixScheduler = new AudioScheduler(audioContext);
    this.automixScheduler.start();
    this.automixScheduler.setTickHandler(this.onAutomixSchedulerTick.bind(this));
  }

  /**
   * 停止精确定时器，清理定时器内所有尚未执行的回调
   */
  public stopAutomixScheduler(): void {
    if (this.automixScheduler) {
      this.automixScheduler.stop();
      this.automixScheduler.clearAll();
      this.automixScheduler = null;
    }
  }

  /**
   * 将 Automix 的流转状态进行降级或重置
   * 比如从“调度中”退回到“监视中”，并取消相关定时器的注册任务
   * @param state 目标 Automix 状态
   */
  public resetAutomixScheduling(state: AutomixState): void {
    this.automixState = state;
    if (this.automixScheduleGroupId && this.automixScheduler) {
      this.automixScheduler.clearGroup(this.automixScheduleGroupId);
    }
    this.automixScheduleGroupId = null;
    this.automixScheduledCtxTime = null;
    this.automixScheduledToken = null;
    this.automixScheduledNextId = null;

    if (state === "IDLE") {
      this.stopAutomixScheduler();
    }
  }

  /**
   * 由底层 AudioScheduler 每隔几十毫秒（具体取决于刷新率）回调一次
   * 读取真实音频引擎的进度时间量
   * 当进入预设触发混音的“倒计时 45 秒”时开始调用计算模块
   */
  public onAutomixSchedulerTick(): void {
    const audioManager = useAudioManager();

    if (
      this.automixState !== "MONITORING" &&
      this.automixState !== "SCHEDULED" &&
      this.automixState !== "TRANSITIONING"
    ) {
      return;
    }

    const { duration } = audioManager;
    if (!duration || duration <= 0) return;
    const rawTime = audioManager.currentTime;
    if (!Number.isFinite(rawTime) || rawTime < 0) return;
    const timeLeft = duration - rawTime;
    if (timeLeft < 0) return;

    if (this.automixState === "TRANSITIONING") {
      if (timeLeft < 0.1) {
        this.resetAutomixScheduling("IDLE");
      }
      return;
    }

    // MONITORING 和 SCHEDULED 状态下逻辑一致：剩余时间 <= 45s 时尝试调度
    if (
      (this.automixState === "MONITORING" || this.automixState === "SCHEDULED") &&
      timeLeft <= 45
    ) {
      this.maybeScheduleAutomix(rawTime);
    }
  }

  /**
   * 尝试计算分析并生成下一个接力混合过渡的最终预案
   * 当发现剩余时间符合 `triggerTime` 要求时，通过 AudioScheduler 注册未来的切歌回调 `beginAutomix`
   * @param rawTime 当前播放时间 (秒)
   */
  public maybeScheduleAutomix(rawTime: number): void {
    const scheduler = this.automixScheduler;
    if (!scheduler) return;

    const plan = this.computeAutomixPlan(rawTime);
    if (!plan) return;

    if (plan.triggerTime <= rawTime) {
      this.beginAutomix(plan);
      return;
    }

    const audioContext = getSharedAudioContext();
    const ctxTriggerTime = audioContext.currentTime + (plan.triggerTime - rawTime);

    if (
      this.automixState === "SCHEDULED" &&
      this.automixScheduledCtxTime !== null &&
      this.automixScheduledToken === plan.token &&
      this.automixScheduledNextId === plan.nextSong.id &&
      Math.abs(this.automixScheduledCtxTime - ctxTriggerTime) < 0.1
    ) {
      return;
    }

    if (this.automixScheduleGroupId) {
      scheduler.clearGroup(this.automixScheduleGroupId);
    }

    const groupId = scheduler.createGroupId("automix");
    this.automixScheduleGroupId = groupId;
    this.automixScheduledCtxTime = ctxTriggerTime;
    this.automixScheduledToken = plan.token;
    this.automixScheduledNextId = plan.nextSong.id;
    this.automixState = "SCHEDULED";

    scheduler.runAt(groupId, ctxTriggerTime, () => this.beginAutomix(plan));
    this.automixLog(
      "log",
      `schedule:${plan.nextSong.id}:${Math.round(plan.triggerTime * 10)}:${Math.round(plan.crossfadeDuration * 10)}:${Math.round(plan.startSeek)}`,
      `[Automix] 已调度：触发 ${this.formatAutomixTime(plan.triggerTime)}，时长 ${this.formatAutomixTime(plan.crossfadeDuration)}，Seek ${this.formatAutomixTime(plan.startSeek / 1000)}，Rate ${plan.initialRate.toFixed(4)}，类型 ${plan.mixType}`,
      0,
    );
  }

  /**
   * 按计算好的 Automix 过渡计划立即触发底层切歌或混音
   * @param plan 混音计划（包含目标歌曲信息、各种混音参数等）
   */
  public beginAutomix(plan: AutomixPlan): void {
    const playerController = usePlayerController();
    const statusStore = useStatusStore();
    const settingStore = useSettingStore();

    if (
      playerController.isTransitioning ||
      !statusStore.playStatus ||
      !settingStore.enableAutomix ||
      statusStore.personalFmMode
    ) {
      this.resetAutomixScheduling("IDLE");
      return;
    }

    if (plan.token !== playerController.currentRequestToken) {
      this.resetAutomixScheduling("MONITORING");
      return;
    }

    if (this.automixScheduleGroupId && this.automixScheduler) {
      this.automixScheduler.clearGroup(this.automixScheduleGroupId);
    }
    this.automixScheduleGroupId = null;
    this.automixScheduledCtxTime = null;
    this.automixScheduledToken = null;
    this.automixScheduledNextId = null;

    statusStore.triggerAutomixFx();
    playerController.isTransitioning = true;
    this.automixState = "TRANSITIONING";

    void this.automixPlay(plan.nextSong, plan.nextIndex, {
      autoPlay: true,
      crossfadeDuration: plan.crossfadeDuration,
      startSeek: plan.startSeek,
      initialRate: plan.initialRate,
      uiSwitchDelay: plan.uiSwitchDelay,
      mixType: plan.mixType,
    });
  }

  /**
   * 提前预取并分析下一首将被播放的音频特征和可选的模型生成的长段混音预案
   * web 环境暂无离线特征分析能力，此方法为空操作
   * @param nextSong 即将被播放的候选歌曲
   */
  public prefetchAutomixNextData(_nextSong: SongType) {
    // web 环境暂无离线特征分析与过渡建议能力，跳过预取
  }

  /**
   * 核心混音计算逻辑：根据当前和下一首歌的分析特征（如 BPM、人声淡出点、乐器留白等）
   * 计算出一个精确无缝的 `AutomixPlan`。包含了退出的时间点、混音长度、需要调整的速率等。
   * 此方法通过复杂的判定树保证人声不会被意外截断。
   * @param _rawTime 当前音频进度的时间戳
   * @returns AutomixPlan 对象。如果不满足触发条件（如未分析完成）则返回 null
   */
  public computeAutomixPlan(_rawTime: number): AutomixPlan | null {
    const playerController = usePlayerController();
    const nextInfo = this.getNextSongForAutomix();
    if (!nextInfo) return null;
    this.prefetchAutomixNextData(nextInfo.song);

    const currentAnalysis = playerController.currentAnalysis;
    const nextAnalysis = this.nextAnalysis;
    const duration = playerController.getDuration() / 1000;

    const canTrustExitPoint = !!currentAnalysis && playerController.currentAnalysisKind === "full";
    const vocalOut = canTrustExitPoint ? currentAnalysis.vocal_out_pos : undefined;
    let rawFadeOut = canTrustExitPoint ? currentAnalysis.fade_out_pos || duration : duration;
    rawFadeOut = Math.min(rawFadeOut, duration);
    if (vocalOut !== undefined && rawFadeOut < vocalOut - 0.1) {
      this.automixLog(
        "warn",
        "fade_out_early",
        `Fade out ${rawFadeOut} < Vocal out ${vocalOut}`,
        5000,
      );
      rawFadeOut = duration;
    }
    let exitPoint = rawFadeOut;

    if (canTrustExitPoint && currentAnalysis.cut_out_pos !== undefined) {
      const cutOut = currentAnalysis.cut_out_pos;
      const cutIn = currentAnalysis.cut_in_pos ?? currentAnalysis.fade_in_pos ?? 0;
      if (Number.isFinite(cutOut) && cutOut > 0 && cutOut <= duration && cutOut - cutIn > 30) {
        exitPoint = cutOut;
        if (vocalOut !== undefined && exitPoint < vocalOut - 0.1) {
          this.automixLog(
            "warn",
            "cut_out_early",
            `Cut out ${exitPoint} < Vocal out ${vocalOut}`,
            5000,
          );
          exitPoint = rawFadeOut;
        }
      }
    }

    let triggerTime = exitPoint - 8.0;
    let crossfadeDuration = 8.0;
    let startSeek = 0;
    const mixType: "default" | "bassSwap" = "default";
    const initialRate = 1.0;
    let uiSwitchDelay = 0;

    // 存在双端分析数据时按 BPM 对齐淡入淡出参数
    if (currentAnalysis && nextAnalysis) {
      crossfadeDuration = 8.0;
      let rawTrigger = exitPoint - crossfadeDuration;

      if (currentAnalysis.bpm && currentAnalysis.first_beat_pos !== undefined) {
        rawTrigger = this.snapToBeat(
          rawTrigger,
          currentAnalysis.bpm,
          currentAnalysis.first_beat_pos,
          true,
        );
      }

      triggerTime = rawTrigger;
      startSeek = (nextAnalysis.fade_in_pos || 0) * 1000;

      if (duration - triggerTime < 4.0) {
        triggerTime = exitPoint - crossfadeDuration;
      }
    }

    if (canTrustExitPoint && currentAnalysis.vocal_out_pos) {
      const plan = this.applyAggressiveOutro(
        currentAnalysis,
        triggerTime,
        crossfadeDuration,
        exitPoint,
      );
      if (plan) {
        triggerTime = plan.triggerTime;
        crossfadeDuration = plan.crossfadeDuration;
      }
    }

    if (triggerTime + crossfadeDuration > duration) {
      crossfadeDuration = Math.max(0.5, duration - triggerTime);
    }
    uiSwitchDelay = uiSwitchDelay || crossfadeDuration * 0.5;

    return this.createAutomixPlan(
      nextInfo,
      triggerTime,
      crossfadeDuration,
      startSeek,
      initialRate,
      uiSwitchDelay,
      mixType,
    );
  }

  /**
   * 便捷工厂方法：构造强类型的 `AutomixPlan` 对象
   * 包含防伪 Token 和相关的属性，通过它进行正式的调度接力
   */
  public createAutomixPlan(
    nextInfo: { song: SongType; index: number },
    triggerTime: number,
    crossfadeDuration: number,
    startSeek: number,
    initialRate: number,
    uiSwitchDelay: number,
    mixType: "default" | "bassSwap",
  ): AutomixPlan {
    const playerController = usePlayerController();
    return {
      token: playerController.currentRequestToken,
      nextSong: nextInfo.song,
      nextIndex: nextInfo.index,
      triggerTime,
      crossfadeDuration,
      startSeek,
      initialRate,
      uiSwitchDelay,
      mixType,
    };
  }

  /**
   * 将强制的人声结束逻辑（Aggressive Outro）应用于现有的切换触发点上
   * 如果当前歌曲包含较高能量的尾奏，但人声其实早就结束了，为了避免听众等待过长的纯音乐尾奏，
   * 会通过节拍对齐截断尾奏并缩短混音时间，实现更紧凑的听感。
   */
  public applyAggressiveOutro(
    analysis: AudioAnalysis,
    currentTrigger: number,
    currentDuration: number,
    exitPoint: number,
  ): { triggerTime: number; crossfadeDuration: number } | null {
    if (!analysis.vocal_out_pos) return null;
    const vocalOut = analysis.vocal_out_pos;
    const tailLength = exitPoint - vocalOut;

    if (tailLength <= 8.0) return null;

    const outroEnergy = analysis.outro_energy_level ?? -70;
    const isHighEnergy = outroEnergy > -12.0;

    const beatsToWait = isHighEnergy ? 8 : 1;
    let newTrigger = currentTrigger;

    if (analysis.bpm && analysis.first_beat_pos !== undefined) {
      const spb = 60 / analysis.bpm;
      const relVocal = vocalOut - analysis.first_beat_pos;
      let beatIndex = Math.floor(relVocal / spb);

      if (relVocal % spb > spb * 0.9) beatIndex++;

      let targetBeat = beatIndex + beatsToWait;
      if (isHighEnergy) targetBeat = Math.ceil(targetBeat / 4) * 4;

      newTrigger = analysis.first_beat_pos + targetBeat * spb;
    } else {
      newTrigger = vocalOut + (isHighEnergy ? 4.0 : 0.5);
    }

    if (newTrigger < currentTrigger && newTrigger < exitPoint - 1.0) {
      const maxFade = isHighEnergy ? 8.0 : 5.0;
      const newDuration = Math.min(currentDuration, maxFade, exitPoint - newTrigger);
      this.automixLog(
        "log",
        "aggressive_outro",
        `Aggressive Outro: ${tailLength.toFixed(1)}s tail, trigger ${newTrigger.toFixed(1)}`,
        5000,
      );
      return { triggerTime: newTrigger, crossfadeDuration: newDuration };
    }
    return null;
  }

  /**
   * 执行带有混音效果的歌曲播放加载动作
   * 不会走普通的硬切播放，而是计算匹配后的增益、进度和交叉混音参数进行底层音频引擎衔接。
   * @param targetSong 期望无缝切入的下一首目标歌曲对象
   * @param targetIndex 目标歌曲在歌单中的 Index
   * @param options 包含切换过渡参数的配置信息（包含初速度、延迟、淡入时间等）
   */
  public async automixPlay(
    targetSong: SongType,
    targetIndex: number,
    options: {
      autoPlay?: boolean;
      crossfadeDuration: number;
      startSeek: number;
      initialRate: number;
      uiSwitchDelay?: number;
      mixType?: "default" | "bassSwap";
    },
  ) {
    const statusStore = useStatusStore();
    const playerController = usePlayerController();

    // 生成新的 requestToken
    this.automixLogTimestamps.clear();
    playerController.currentRequestToken++;
    const requestToken = playerController.currentRequestToken;

    try {
      // 准备数据
      const { audioSource } = await playerController.prepareAudioSource(targetSong, requestToken, {
        forceCacheForOnline: true,
        analysis: "none",
      });

      const analysisKey = targetSong.path || null;
      const analysis =
        analysisKey && this.nextAnalysisKey === analysisKey && this.nextAnalysis
          ? this.nextAnalysis
          : null;
      const analysisKind: "none" | "head" | "full" = analysis ? this.nextAnalysisKind : "none";

      // Automix Gain Calculation (LUFS)
      if (playerController.currentAnalysis?.loudness && analysis?.loudness) {
        const currentLoudness = playerController.currentAnalysis.loudness;
        const nextLoudness = analysis.loudness;
        const gainDb = currentLoudness - nextLoudness;
        // Limit gain to avoiding extreme changes (+/- 9dB)
        const safeGainDb = Math.max(-9, Math.min(gainDb, 9));
        this.automixGain = Math.pow(10, safeGainDb / 20);
        console.log(
          `🔊 [Automix] Loudness Match: ${currentLoudness.toFixed(2)} -> ${nextLoudness.toFixed(2)} LUFS (Gain: ${safeGainDb.toFixed(2)}dB)`,
        );
      } else {
        this.automixGain = 1.0;
      }

      // 更新当前分析结果
      playerController.currentAnalysis = analysis;
      playerController.currentAnalysisKind = analysis ? analysisKind : "none";
      // 重置下一首分析缓存
      this.nextAnalysis = null;
      this.nextAnalysisKind = "none";

      // 启动 Crossfade
      const uiSwitchDelay = options.uiSwitchDelay ?? options.crossfadeDuration * 0.5;

      // 计算 ReplayGain
      const replayGain = playerController.applyReplayGain(targetSong, false);

      await playerController.loadAndPlay(
        audioSource.url,
        options.autoPlay ?? true,
        options.startSeek,
        {
          duration: options.crossfadeDuration,
          uiSwitchDelay,
          mixType: options.mixType,
          replayGain,
          deferStateSync: true,
          onSwitch: () => {
            console.log("🔀 [Automix] Switching UI to new song");
            playerController.isTransitioning = false;
            this.automixState = "MONITORING";
            // 提交状态切换
            statusStore.playIndex = targetIndex;
            statusStore.endAutomixFx();
            playerController.setupSongUI(targetSong, options.startSeek);
            playerController.afterPlaySetup(targetSong);
          },
        },
        options.initialRate,
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "EXPIRED") {
        // Token 过期意味着有新的播放请求已接管，静默忽略
        console.log("[Automix] Transition cancelled (new request)");
        return;
      }
      console.error("Automix failed, fallback to normal play", e);
      if (requestToken === playerController.currentRequestToken) {
        playerController.isTransitioning = false;
        this.resetAutomixScheduling("IDLE");
        statusStore.playIndex = targetIndex;
        statusStore.endAutomixFx();
        playerController.playSong({ autoPlay: true });
      }
    }
  }

  public getNextSongForAutomix(): { song: SongType; index: number } | null {
    const dataStore = useDataStore();
    const statusStore = useStatusStore();
    const playerController = usePlayerController();

    if (dataStore.playList.length === 0) return null;

    // 单曲循环模式下，下一首就是当前这首
    if (statusStore.repeatMode === "one") {
      const currentSong = dataStore.playList[statusStore.playIndex];
      if (currentSong) {
        return { song: currentSong, index: statusStore.playIndex };
      }
    }

    if (dataStore.playList.length <= 1) return null;

    let nextIndex = statusStore.playIndex;
    let attempts = 0;
    const maxAttempts = dataStore.playList.length;

    while (attempts < maxAttempts) {
      nextIndex++;
      if (nextIndex >= dataStore.playList.length) nextIndex = 0;

      const nextSong = dataStore.playList[nextIndex];
      if (!playerController.shouldSkipSong(nextSong)) {
        return { song: nextSong, index: nextIndex };
      }
      attempts++;
    }
    return null;
  }
}

const AUTOMIX_MANAGER_KEY = "__SPLAYER_AUTOMIX_MANAGER__";
export const useAutomixManager = (): AutomixManager => {
  const win = window as Window & { [AUTOMIX_MANAGER_KEY]?: AutomixManager };
  if (!win[AUTOMIX_MANAGER_KEY]) {
    win[AUTOMIX_MANAGER_KEY] = new AutomixManager();
  }
  return win[AUTOMIX_MANAGER_KEY];
};
