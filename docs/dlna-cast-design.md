# PocketTune DLNA 局域网投送（DMC）设计文档

日期：由实现前确认
状态：待确认
作者：AI 助手

## 0. 背景与目标

用户场景：小米手机（PocketTune PWA）→ 雷鸟电视。小米秒播为私有协议（米联），雷鸟（TCL 系）为其自身 DLNA 生态，两者互认失败。
目标：让 PocketTune 在前端增加"DLNA 投送"能力，把自己变成 DLNA 控制端（DMC），把当前播放歌曲投送到局域网内的雷鸟电视（标准 DLNA 渲染器 DMR），电视自己拉流播放。
音源以网易云接口为主，可能涉及 UNM 解锁第三方音源。

## 1. 方案选型结论（已确认）

- 采用「后端 DMC + 前端投送按钮」架构。
- 发送端（DMC）逻辑全部放在 Fastify 后端：SSDP 发现 + SOAP 控制。
- 前端 PWA 通过 HTTP 调用后端，设备列表与投送/控制均走后端中转。
- 投送成功后：本地播放暂停，电视接管；前端保留封面/歌词/进度展示，进度通过轮询电视同步；控制按钮作用于电视。
- 零新增 npm 依赖：SSDP 用 Node 原生 `dgram` 组播手写，SOAP 用现有 `axios` 手写 XML。
- 网易云直链可直接给电视；UNM 解锁音源复用现有 `/api/unblock/proxy` 同源转发。

### 为什么浏览器 PWA 不能直接做 DMC

- DLNA/UPnP 依赖 SSDP（UDP 1900 组播 M-SEARCH）与 SOAP/HTTP，浏览器 JS 无法发送 UDP 组播包，也没有原生的 SOAP 客户端。
- 因此 DMC 必须运行在非浏览器进程（本项目即后端 Node 进程）。

## 2. 数据流

```
[PWA 前端]  --HTTP-->  [Fastify /api/dlna/*]  --SSDP M-SEARCH(组播)--> [雷鸟电视 DMR]
                          │                                                239.255.255.250:1900
                          │                                                响应 deviceDesc.xml
                          │--SOAP  HTTP POST controlURL -->
                          │     SetAVTransportURI(音频绝对URL)
                          │     Play / Pause / Stop / Seek / SetVolume
                          │     <-- GetPositionInfo / GetTransportInfo <--
                          └--记录设备列表（内存缓存）--┘
```

- 发现：`POST /api/dlna/discover`，后端发 SSDP M-SEARCH，收集 2~3 秒响应，解析 deviceDesc.xml 中 `deviceType` 含 `MediaRenderer` 的设备，返回 `[{uuid, name, location, controlURLs...}]`。
- 投送：`POST /api/dlna/play`，body `{uuid, url}`，后端对目标 SetAVTransportURI + Play。
- 控制：`POST /api/dlna/control`，body `{uuid, action, value?}`，action 支持 `play|pause|stop|seek|volume`。
- 进度轮询：`GET /api/dlna/status?uuid=...`，后端 GetTransportInfo + GetPositionInfo，返回 `{playing, currentTime, duration}`。

## 3. 投送 URL 处理（核心决策）

前端把当前 `IPlaybackEngine.src` 原样传给后端不总是可行，需在**后端**按两类地址归一化：

1. 网易云官方直链（`music.126.net` / `music.163.com`）：原样透传，电视直连 CDN。
   - 注意：部分网易直链对非浏览器 UA / 无 Referer 可能 403。作为兜底，可在设置中开启"官方音源也走代理"。
2. UNM 解锁第三方音源：前端已改写为相对代理地址 `/api/unblock/proxy?url=...`（见 `src/utils/helper.ts` `toProxiedUrl`）。
   - 后端收到后，用**请求自身的 host**（`req.protocol` + `req.hostname`）重写为绝对地址：`http://<host>/api/unblock/proxy?url=...`，电视请求后端、后端流式转发（现有 `server/unblock/proxy.ts` 已支持流式 + Range 透传），电视可拖动进度。

归一化逻辑（后端）：

- 绝对 http(s) URL 直接使用。
- 以 `/` 开头（相对代理地址）→ 用请求 host 补全成绝对地址。
- 非 http 协议（如 blob:、本地文件）→ 投送该源时给出明确错误提示（本地文件/实时流暂不支持投电视）。

## 4. 服务端新文件与接口

- `server/dlna/ssdp.ts`：SSDP 设备发现（`dgram` 组播 M-SEARCH + 解析 deviceDesc.xml）。
- `server/dlna/avtransport.ts`：面向单个设备的 SOAP 调用封装（SetAVTransportURI / Play / Pause / Stop / Seek / SetVolume / GetTransportInfo / GetPositionInfo），用 axios 发 XML。
- `server/dlna/index.ts`：注册插件到 `/api/dlna`，实现上述 5 个路由；持有设备列表内存缓存（含 getter，更新即返回）。
- 寄存器：在 `server/index.ts` 增加 `server.register(initDlnaAPI, { prefix: "/api", ... })`。

接口汇总：
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/dlna/discover` | 扫描局域网 DMR 设备 |
| POST | `/api/dlna/play` | 投送 url 到目标设备并播放 |
| POST | `/api/dlna/control` | play/pause/stop/seek/volume |
| GET | `/api/dlna/status` | 轮询播放进度/状态 |

## 5. 前端改动

- `src/api/dlna.ts`：封装上述接口。
- `src/stores/dlna.ts`：Pinia 状态——`devices`（发现列表）、`activeDevice`（当前投送目标）、`isCasting`、`castingTransport`；持久化最近投送设备 uuid。
- 投送操作：
  - 播放页"投送"按钮（Naive UI 图标按钮，复用现有图标文件，不引入 xicons）。
  - 点击 → 调 discover → Naive UI 弹窗列出设备 → 选设备 → 后端 play → 本地 audio 暂停、进入投送态。
  - 投送态下，本地播放控制（播放/暂停/切歌/进度/音量）转发到后端 control，UI 仍显示封面/歌词/进度（进度轮询 status）。
  - 切歌联动：播放引擎切歌时若处于投送态，自动用新歌 URL 重新 play。
  - 断开投送：control stop + 关闭投送态，恢复本地从电视当前进度播放（可选：恢复到投送前本地进度）。
- 组件：新增 `PlayTo` 相关 UI（弹窗 + 投送状态条），遵循 Naive UI 与既有图标规范。

## 6. 待确认/边界

- 官方网易直链 403 的兜底开关：默认关闭，出问题再开。
- 本地文件 / blob URL / 实时流暂不支持投送（给出提示），后续可评估后端代理 HttpRange 中转。
- 电视端需与后端网络互通（已确认同一局域网且电视可访问后端）。
- 无显示器时的播放状态：以电视为准，前端仅做展示与控制。

## 7. 验收标准

- 同一局域网内，后端能发现雷鸟电视（deviceType=MediaRenderer）。
- 点击投送后，电视扬声器出声，本地静默，封面/歌词/进度正常显示。
- 播放/暂停/切歌/进度拖动/音量在投送态下作用于电视。
- `pnpm lint` 0 错误 0 警告；`pnpm typecheck` 通过；注释全中文；无临时文件残留。
- 第三方解锁音源能正常投到电视（经现有 unblock/proxy 转发）。

## 8. 分支与流程（遵循 AGENTS.md）

- 全部在 `dev` 分支开发；不擅自合并 main、不触发构建、不本地构建 Docker 镜像。
