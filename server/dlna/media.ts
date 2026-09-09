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
 * 计算媒体缓存 key 与 token
 */
const mediaKey = (audioUrl: string, coverUrl?: string): string =>
  createHash("md5")
    .update(`${audioUrl}|${coverUrl ?? ""}`)
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
    const file = path.join(CACHE_DIR, `cover-${createHash("md5").update(coverUrl).digest("hex")}`);
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
 * 静态封面帧 + 音频重编码 AAC，输出 faststart mp4（支持电视边下边播与拖动）
 * @returns 成功返回输出文件路径，失败返回 null
 */
const runFfmpeg = (coverFile: string, audioUrl: string, outFile: string): Promise<boolean> =>
  new Promise((resolve) => {
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
      "scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2",
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
 * 缓存清理：超过上限时按修改时间删除最旧的文件
 */
const pruneCache = async (): Promise<void> => {
  const entries = await readdir(CACHE_DIR);
  const files: { file: string; mtime: number }[] = [];
  for (const name of entries) {
    if (!name.endsWith(".mp4")) continue;
    const file = path.join(CACHE_DIR, name);
    const info = await stat(file);
    files.push({ file, mtime: info.mtimeMs });
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
 * @returns 可投送的媒体 URL（相对路径 /api/dlna/media?token=...），失败返回 null
 */
export const ensureCoverMedia = async (
  audioUrl: string,
  coverUrl?: string,
): Promise<string | null> => {
  if (!cacheDirReady) {
    await mkdir(CACHE_DIR, { recursive: true });
    cacheDirReady = true;
  }
  const key = mediaKey(audioUrl, coverUrl);
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
    try {
      // 无封面时无法合成视频
      if (!coverUrl) return null;
      const coverFile = await downloadCover(coverUrl);
      if (!coverFile) return null;
      serverLog.info("🎬 开始合成封面视频流...");
      const ok = await runFfmpeg(coverFile, audioUrl, outFile);
      // 失败清理半成品
      if (!ok) {
        await unlink(outFile).catch(() => undefined);
        return null;
      }
      tokenIndex.set(key, outFile);
      serverLog.info(`✅ 封面视频合成完成: ${outFile}`);
      void pruneCache();
      return `/api/dlna/media?token=${key}`;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
};

/**
 * 按 token 获取缓存文件路径
 */
export const getMediaFile = (token: string): string | null => tokenIndex.get(token) ?? null;
