import { defineStore } from "pinia";
import axios from "axios";
import type { SongLevelType, SongType } from "@/types/main";
import { songDownloadUrl } from "@/api/song";
import { uploadCloudSong } from "@/api/cloud";
import { useSettingStore } from "@/stores/setting";
import { getPlayerInfoObj } from "@/utils/format";
import { toProxiedUrl } from "@/utils/helper";

// 任务状态
export type CloudUploadStatus = "pending" | "uploading" | "success" | "error" | "canceled";

// 后台云盘上传任务
export interface CloudUploadTask {
  /** 任务唯一 id */
  id: number;
  /** 任务类型：download 下载歌曲后上传 | file 本地文件直接上传 */
  kind: "download" | "file";
  /** 展示的文件名 */
  displayName: string;
  /** 文件大小（可选，仅本地文件） */
  fileSize?: number;
  /** 下载进度（0-100，仅 download 任务） */
  downProgress: number;
  /** 上传进度（0-100） */
  upProgress: number;
  /** 任务状态 */
  status: CloudUploadStatus;
  /** 失败原因 */
  errorMessage?: string;
  /** 完成时间戳（成功/失败/取消时记录） */
  finishedAt?: number;
  /** 备用：歌曲对象（download 任务） */
  song?: SongType;
  /** 音质（download 任务） */
  quality?: SongLevelType;
  /** 标记取消 */
  canceled?: boolean;
  /** 本地文件（file 任务） */
  _file?: File;
  /** 取消控制器（处理中） */
  _controller?: AbortController;
  /** 上传文件名（download 任务，不含扩展名） */
  _fileName?: string;
}

// 提取失败原因
const getErrorMessage = (error: any): string => {
  if (axios.isCancel(error)) return "上传已取消";
  if (!error) return "未知错误";
  // 接口返回结构错误信息
  if (error?.msg) return String(error.msg);
  // 网络错误
  if (error?.response) {
    return `服务器响应异常（${error.response.status || ""}）`;
  }
  if (error?.request) return "网络请求失败，请检查网络连接";
  return error?.message || "上传失败，请重试";
};

let taskId = 0;
let processing = false;

export const useCloudUploadStore = defineStore("cloudUpload", () => {
  // 设置
  const settingStore = useSettingStore();
  // 上传任务队列
  const tasks = ref<CloudUploadTask[]>([]);
  // 当前是否正在串行处理
  const isProcessing = ref(false);
  // 进度面板是否显示
  const panelVisible = ref(false);

  // 是否有正在进行中的任务（用于面板判断是否可关闭）
  const hasRunning = computed(() =>
    tasks.value.some((t) => t.status === "pending" || t.status === "uploading"),
  );

  // 进行中/待处理任务数（按钮角标）
  const runningCount = computed(
    () => tasks.value.filter((t) => t.status === "pending" || t.status === "uploading").length,
  );

  // 追加任务并开始串行处理
  const enqueue = (task: CloudUploadTask) => {
    tasks.value.push(task);
    runQueue();
  };

  // 切换进度面板显示
  const togglePanel = () => {
    panelVisible.value = !panelVisible.value;
  };

  // 歌曲下载后上传至云盘
  const uploadSongToCloud = (song: SongType, quality?: SongLevelType) => {
    const infoObj = getPlayerInfoObj(song) || {
      name: song?.name || "未知歌曲",
      artist: "未知歌手",
    };
    const baseTitle = infoObj.name || "未知歌曲";
    const rawArtist = infoObj.artist || "未知歌手";
    const safeArtist = rawArtist.replace(/[/:*?"<>|]/g, "&");
    // 根据文件名格式生成基础文件名（不含扩展名）
    let fileName = baseTitle;
    if (settingStore.fileNameFormat === "artist-title") fileName = `${safeArtist} - ${baseTitle}`;
    else if (settingStore.fileNameFormat === "title-artist")
      fileName = `${baseTitle} - ${safeArtist}`;
    fileName = fileName.replace(/[/:*?"<>|]/g, "&");
    enqueue({
      id: ++taskId,
      kind: "download",
      displayName: `${infoObj.name}${infoObj.artist ? ` - ${infoObj.artist}` : ""}`,
      downProgress: 0,
      upProgress: 0,
      status: "pending",
      song,
      quality,
      _fileName: fileName,
    });
  };

  // 本地文件上传至云盘
  const uploadFilesToCloud = (files: File[]) => {
    if (!files?.length) return;
    files.forEach((file) => {
      enqueue({
        id: ++taskId,
        kind: "file",
        displayName: file.name,
        fileSize: file.size,
        downProgress: 100,
        upProgress: 0,
        status: "pending",
        _file: file,
      });
    });
  };

  // 取消单个任务（仅对未处理/处理中的任务有效）
  const cancelTask = (id: number) => {
    const task = tasks.value.find((t) => t.id === id);
    if (!task) return;
    if (task.status === "pending") {
      task.status = "canceled";
      task.finishedAt = Date.now();
      return;
    }
    if (task.status === "uploading") {
      task.canceled = true;
      task._controller?.abort();
    }
  };

  // 清空已结束的任务
  const clearFinished = () => {
    tasks.value = tasks.value.filter((t) => t.status === "pending" || t.status === "uploading");
  };

  // 关闭面板（会话内保留全部记录，不清空）
  const closePanel = () => {
    panelVisible.value = false;
  };

  // 串行处理队列
  const runQueue = async () => {
    if (processing) return;
    processing = true;
    isProcessing.value = true;
    while (tasks.value.length) {
      const task = tasks.value.find((t) => t.status === "pending");
      if (!task) break;
      task.status = "uploading";
      task._controller = new AbortController();
      try {
        if (task.kind === "download") await processDownloadTask(task);
        else await processFileTask(task);
      } catch (error: any) {
        if (task.canceled) {
          task.status = "canceled";
          task.finishedAt = Date.now();
        } else {
          task.status = "error";
          task.errorMessage = getErrorMessage(error);
          task.finishedAt = Date.now();
          window.$notification.error({
            title: "上传失败",
            content: task.errorMessage,
            duration: 5000,
          });
        }
      }
    }
    processing = false;
    isProcessing.value = false;
  };

  // 下载任务：下载歌曲后上传
  const processDownloadTask = async (task: CloudUploadTask) => {
    const song = task.song!;
    const signal = task._controller?.signal;
    // 1. 获取下载链接
    const result = await songDownloadUrl(song.id, task.quality, signal);
    if (result.code !== 200 || !result?.data?.url) {
      throw new Error(result.message || "获取下载链接失败");
    }
    if (task.canceled) throw new Error("canceled");
    const downloadUrl = result.data.url;
    const fileType = (result.data.type || "mp3").toLowerCase();

    // 2. 拉取音频二进制（经同源代理避免跨域）
    const proxyUrl = toProxiedUrl(downloadUrl, true);
    const response = await axios.get(proxyUrl, {
      responseType: "blob",
      signal,
      onDownloadProgress: (event) => {
        if (event.total) {
          task.downProgress = Math.round((event.loaded * 100) / event.total);
        }
      },
    });
    if (task.canceled) throw new Error("canceled");
    const blob = response.data;
    if (!blob || blob.size === 0) throw new Error("音频下载失败，请重试");

    // 3. 上传到云盘
    const fileName = task._fileName || task.displayName;
    const file = new File([blob], fileName + "." + fileType, {
      type: blob.type || "audio/mpeg",
    });
    const uploadResult = await uploadCloudSong(
      file,
      (percent) => {
        task.upProgress = percent;
      },
      signal,
    );
    handleUploadResult(task, uploadResult);
    task.downProgress = 100;
    task.upProgress = 100;
  };

  // 本地文件任务：直接上传
  const processFileTask = async (task: CloudUploadTask) => {
    const file = task._file;
    if (!file) throw new Error("文件数据缺失，无法上传");
    const signal = task._controller?.signal;
    const uploadResult = await uploadCloudSong(
      file,
      (percent) => {
        task.upProgress = percent;
      },
      signal,
    );
    handleUploadResult(task, uploadResult);
    task.upProgress = 100;
  };

  // 统一处理上传结果并弹通知
  const handleUploadResult = (task: CloudUploadTask, uploadResult: any) => {
    if (uploadResult?.code === 200) {
      const failed = uploadResult?.data?.failed?.[0];
      if (failed?.code !== -200) {
        task.status = "success";
        task.finishedAt = Date.now();
        window.$notification.success({
          title: "上传成功",
          content: `${task.displayName} 已成功上传至云盘`,
          duration: 4000,
        });
      } else {
        throw new Error(failed?.msg || "上传失败，请重试");
      }
    } else {
      throw new Error(uploadResult?.msg || "上传失败，请重试");
    }
  };

  return {
    tasks,
    isProcessing,
    panelVisible,
    hasRunning,
    runningCount,
    uploadSongToCloud,
    uploadFilesToCloud,
    cancelTask,
    clearFinished,
    closePanel,
    togglePanel,
  };
});
