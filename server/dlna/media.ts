// DLNA 封面视频流合成：ffmpeg 将封面图与音频封装为带静态画面的视频
// 电视以视频方式播放，全屏显示封面，避免音频投送黑屏
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import { serverLog } from "../utils/logger";

// 缓存目录与上限（文件数）
const CACHE_DIR = path.join(os.tmpdir(), "dlna-media-cache");
const MAX_CACHE_FILES = 50;

// 通用浏览器 UA（拉取音源与封面用）
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 音源防盗链 Referer 映射（与 unblock/proxy 保持一致的策略）
const REFERER_MAP: { suffix: string; referer: string }[] = [
  { suffix: "kuwo.cn", referer: "https://www.kuwo.cn/" },
  { suffix: "kugou.com", referer: "https://www.kugou.com/" },
  { suffix: "migu.cn", referer: "https://www.migu.cn/" },
  { suffix: "bilivideo.com", referer: "https://www.bilibili.com/" },
  { suffix: "163.com", referer: "https://music.163.com/" },
  { suffix: "126.net", referer: "https://music.163.com/" },
];

// 按目标域名挑选 Referer
const refererFor = (host: string): string =>
  REFERER_MAP.find((item) => host === item.suffix || host.endsWith(`.${item.suffix}`))?.referer ??
  "https://music.163.com/";

// 缓存命中映射：token → 缓存文件路径
const tokenIndex = new Map<string, string>();

// 进行中的合成任务去重（同 key 并发请求共用一次生成）
const inFlight = new Map<string, Promise<string | null>>();

// 初始化时标记缓存目录（延迟创建）
let cacheDirReady = false;

/**
 * 毫秒转 ASS 时间格式 (H:MM:SS.cc)
 */
const formatAssTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
};

/**
 * 歌词行（与前端 LyricLine 结构一致的精简形态）
 */
export interface LyricLineInput {
  /** 行起始时间（毫秒） */
  startTime: number;
  /** 行结束时间（毫秒） */
  endTime: number;
  /** 行文本 */
  words: string;
  /** 翻译（可选） */
  translatedLyric?: string;
}

/**
 * 生成 ASS 字幕（后端精简版）
 * KTV 风格：当前句白色大字（含翻译小字）+ 下一句灰色预览，随播放逐句滚动
 * 顶部常显歌名/歌手
 */
const generateLyricAss = (
  lines: LyricLineInput[],
  meta: { title?: string; artist?: string },
): string => {
  const header = `[Script Info]
Title: ${meta.title ?? "PocketTune"} - ${meta.artist ?? ""}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 720
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyric,Noto Sans CJK SC,46,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,24,24,36,1
Style: Meta,Noto Sans CJK SC,26,&H50FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1,1,8,24,24,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  // 顶部歌名/歌手（全程显示）
  events.push(
    `Dialogue: 0,0:00:00.00,9:59:59.00,Meta,,0,0,0,,${(meta.title ?? "") + " - " + (meta.artist ?? "")}`,
  );

  // 逐句生成：当前句（亮白，含翻译小字）+ 下一句（灰色预览）同框显示
  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    const next = lines[i + 1];
    const currentText = current.words?.trim();
    if (!currentText) continue;

    // 组装文本：当前句（白色）→ 翻译（小字浅灰）→ 下一句（灰色预览）
    let text = currentText;
    if (current.translatedLyric?.trim()) {
      text += `{\\fs30\\c&HD0D0D0&}\\N${current.translatedLyric.trim()}`;
    }
    if (next?.words?.trim()) {
      text += `{\\r\\c&H787878&\\fs46}\\N${next.words.trim()}`;
    }

    // 当前句显示到下一句开始（无缝衔接），末句多显示 3 秒兜底
    const start = formatAssTime(current.startTime);
    const end = formatAssTime(next ? next.startTime : current.endTime + 3000);
    events.push(`Dialogue: 0,${start},${end},Lyric,,0,0,0,,${text}`);
  }
  return header + events.join("\n") + "\n";
};

/**
 * 计算媒体缓存 key 与 token
 */
const mediaKey = (audioUrl: string, coverUrl?: string, lyricDigest = ""): string =>
  createHash("md5")
    .update(`${audioUrl}|${coverUrl ?? ""}|${lyricDigest}`)
    .digest("hex");

/**
 * 按目标域名挑选 Referer 后的请求头
 */
const headersFor = (targetUrl: string): Record<string, string> => {
  try {
    const host = new URL(targetUrl).hostname;
    return {
      "User-Agent": BROWSER_UA,
      Referer: refererFor(host),
    };
  } catch {
    return { "User-Agent": BROWSER_UA };
  }
};

/**
 * 下载封面图到临时文件
 * 文件名带随机后缀，避免不同歌曲共用封面时的并发读写冲突
 * @returns 本地封面文件路径，失败返回 null
 */
const downloadCover = async (coverUrl: string): Promise<string | null> => {
  try {
    const res = await axios.get<ArrayBuffer>(coverUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
      maxContentLength: 20 * 1024 * 1024,
      headers: headersFor(coverUrl),
    });
    const unique = createHash("md5")
      .update(`${coverUrl}-${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 12);
    const file = path.join(CACHE_DIR, `cover-${unique}`);
    await writeFile(file, Buffer.from(res.data));
    return file;
  } catch (error) {
    serverLog.warn(
      "⚠️ 封面下载失败，降级纯音频投送:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/**
 * 调用 ffmpeg 合成封面视频
 * 静态封面帧 + 音频重编码 AAC，可选烧录 ASS 歌词字幕
 * 输出 faststart mp4（支持电视边下边播与拖动）
 * @param coverFile 封面本地文件
 * @param audioUrl 音频地址（ffmpeg 直接拉流）
 * @param outFile 输出文件
 * @param assFile 字幕文件（可选）
 * @returns 成功返回输出文件路径，失败返回 null
 */
const runFfmpeg = (
  coverFile: string,
  audioUrl: string,
  outFile: string,
  assFile?: string | null,
): Promise<boolean> =>
  new Promise((resolve) => {
    // 基础滤镜：封面等比缩放居中；有字幕时叠加烧录
    const baseFilter =
      "scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2";
    const videoFilter = assFile
      ? `${baseFilter},ass=${assFile.replace(/\\/g, "/").replace(/:/g, "\\:")}`
      : baseFilter;
    const args = [
      "-y",
      "-loop",
      "1",
      "-framerate",
      "2",
      "-i",
      coverFile,
      "-user_agent",
      BROWSER_UA,
      "-headers",
      `Referer: ${refererFor(safeHost(audioUrl))}\r\n`,
      "-i",
      audioUrl,
      "-vf",
      videoFilter,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "stillimage",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      outFile,
    ];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      // 仅保留尾部错误信息用于诊断
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-400);
    });
    child.on("error", (error) => {
      serverLog.error("❌ ffmpeg 启动失败:", error.message);
      resolve(false);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        serverLog.error(`❌ ffmpeg 合成失败 (code ${code}):`, stderrTail);
        resolve(false);
      }
    });
  });

// 安全提取 URL host（失败返回空串）
const safeHost = (targetUrl: string): string => {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return "";
  }
};

/**
 * 缓存清理：
 * 1. 超过上限时按修改时间删除最旧的视频文件
 * 2. 清理滞留超 1 小时的残留字幕/封面文件（正常流程合成后即删，此处兜底）
 */
const pruneCache = async (): Promise<void> => {
  const entries = await readdir(CACHE_DIR);
  const files: { file: string; mtime: number }[] = [];
  const stale: string[] = [];
  const staleLimit = Date.now() - 60 * 60 * 1000;
  for (const name of entries) {
    const file = path.join(CACHE_DIR, name);
    const info = await stat(file);
    // 非视频的中间文件（.ass 字幕 / cover-* 封面）滞留超 1 小时视为残留
    if (!name.endsWith(".mp4")) {
      if (info.mtimeMs < staleLimit) stale.push(file);
      continue;
    }
    files.push({ file, mtime: info.mtimeMs });
  }
  // 兜底清理残留文件
  for (const file of stale) {
    await unlink(file).catch(() => undefined);
  }
  if (files.length <= MAX_CACHE_FILES) return;
  files.sort((a, b) => a.mtime - b.mtime);
  for (const item of files.slice(0, files.length - MAX_CACHE_FILES)) {
    await unlink(item.file).catch(() => undefined);
    // 同步清理 token 索引
    for (const [token, file] of tokenIndex.entries()) {
      if (file === item.file) tokenIndex.delete(token);
    }
  }
};

/**
 * 确保封面视频可用（缓存优先）
 * @param audioUrl 音频绝对地址（后端自行拉流）
 * @param coverUrl 封面地址
 * @param lyrics 歌词行（可选，传入时烧录滚动字幕）
 * @param meta 歌曲元数据（标题/歌手，字幕与顶部信息用）
 * @returns 可投送的媒体 URL（相对路径 /api/dlna/media?token=...），失败返回 null
 */
export const ensureCoverMedia = async (
  audioUrl: string,
  coverUrl?: string,
  lyrics?: LyricLineInput[],
  meta?: { title?: string; artist?: string },
): Promise<string | null> => {
  if (!cacheDirReady) {
    await mkdir(CACHE_DIR, { recursive: true });
    cacheDirReady = true;
  }
  // 缓存 key 混入歌词内容摘要，歌词变化时自动重新合成
  const lyricDigest = lyrics?.length
    ? createHash("md5").update(JSON.stringify(lyrics)).digest("hex").slice(0, 8)
    : "";
  const key = mediaKey(audioUrl, coverUrl, lyricDigest);
  const outFile = path.join(CACHE_DIR, `${key}.mp4`);

  // 缓存命中：直接注册返回
  if (existsSync(outFile)) {
    tokenIndex.set(key, outFile);
    return `/api/dlna/media?token=${key}`;
  }
  // 并发去重：同一首歌共用一次生成
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    // 声明提到 try 外，供 finally 统一清理
    let coverFile: string | null = null;
    let assFile: string | null = null;
    try {
      // 无封面时无法合成视频
      if (!coverUrl) return null;
      coverFile = await downloadCover(coverUrl);
      if (!coverFile) return null;
      // 有歌词时生成字幕文件烧录
      if (lyrics?.length) {
        assFile = path.join(CACHE_DIR, `${key}.ass`);
        await writeFile(assFile, generateLyricAss(lyrics, meta ?? {}), "utf8");
      }
      serverLog.info(`🎬 开始合成封面视频流${assFile ? "（含歌词字幕）" : ""}...`);
      let ok = await runFfmpeg(coverFile, audioUrl, outFile, assFile);
      // 字幕烧录失败（如 ffmpeg 未编译 libass）：降级重试无字幕版本
      if (!ok && assFile) {
        serverLog.warn("⚠️ 字幕烧录失败，降级为无字幕封面视频重试");
        await unlink(outFile).catch(() => undefined);
        ok = await runFfmpeg(coverFile, audioUrl, outFile, null);
      }
      // 合成失败清理半成品
      if (!ok) {
        await unlink(outFile).catch(() => undefined);
        return null;
      }
      tokenIndex.set(key, outFile);
      serverLog.info(`✅ 封面视频合成完成: ${outFile}`);
      void pruneCache();
      return `/api/dlna/media?token=${key}`;
    } finally {
      // 封面与字幕文件在合成结束后即无用处，无论成败立即清理
      inFlight.delete(key);
      if (coverFile) await unlink(coverFile).catch(() => undefined);
      if (assFile) await unlink(assFile).catch(() => undefined);
    }
  })();

  inFlight.set(key, task);
  return task;
};

/**
 * 按 token 获取缓存文件路径
 */
export const getMediaFile = (token: string): string | null => tokenIndex.get(token) ?? null;
