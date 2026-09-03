# 移除桌面端（Electron）代码方案

> 状态：✅ 已完成（v3）
> 目标：本项目仅保留两条运行路径 —— **Docker 部署的 Web 版** 与 **本地 Web 开发**，彻底移除 Electron 桌面端。
>
> ## 执行结果
>
> - `pnpm lint`：0 错误 0 警告 ✅
> - `pnpm typecheck:web` / `typecheck:server`：0 错误 ✅
> - `pnpm build`：vite 构建成功产出 dist/ ✅
> - server：健康检查 / 动态路由 / UNM 挂载均正常；解灰端到端需外网环境（沙箱无外网，失败静默回退按设计工作）

## 一、已确认的决策

| 决策项          | 结论                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地开发后端    | **自建薄后端 `server/`**（从 `electron/server/` 解耦迁移），把 `@neteasecloudmusicapienhanced/api` 作为库挂载，本地与 Docker **共用同一个后端**，天然预留自定义接口扩展点 |
| 渲染层桌面分支  | **彻底清理**（删除所有 `isElectron` / `window.electron` 分支及桌面专属 UI）                                                                                               |
| OpenCC 简繁转换 | **保留** `native/ferrous-opencc-wasm`（web 端也在用，`pkg/` wasm 产物已被 git 跟踪，浏览器可直接运行）                                                                    |

## 二、后端方案说明（自建 `server/`）

### 为什么不直接 `npx @neteasecloudmusicapienhanced/api`

- 它是成品服务器，只能环境变量调参，**加不了自定义接口**，无扩展空间
- Docker 现有 nginx 只代理 `/api/netease`，渲染层消费的 `/api/unblock`（解灰直链）、`/api/qqmusic`（QRC 歌词匹配）在纯 npx 方案下**必然失效**

### 自建 server 的结构（迁移自 `electron/server/`，剥离 Electron 依赖）

| 模块       | 处理     | 说明                                                                                                                                                |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `netease/` | **迁移** | 挂载 `@neteasecloudmusicapienhanced/api` 动态路由到 `/api/netease/*`；唯一耦合点是 `serverLog`（换普通 logger），`ncm-config` 本身是纯 Node fs 操作 |
| `unblock/` | **迁移** | 解灰直链接口（GD音乐台/酷我/波点），耦合点仅 logger；**让 Docker web 版恢复解灰能力**                                                               |
| `qqmusic/` | **迁移** | QQ 音乐 QRC 歌词模糊匹配；**让 Docker web 版恢复该能力**（渲染层 `src/api/qqmusic.ts` 保留）                                                        |
| `unm/`     | **新增** | UnblockNeteaseMusic（`@unblockneteasemusic/server`）库集成，见下方「UNM 集成设计」                                                                  |
| `control/` | **删除** | 纯桌面遥控（往 Electron 主窗口发播放命令），web 无意义                                                                                              |

### UnblockNeteaseMusic 集成设计（`server/unm/`）

> 已核实（源码 `/Users/huanghongda/develop/node/server`，v0.28.0）：包主入口即 `src/provider/match.js`，
> `require("@unblockneteasemusic/server")` 直接得到核心函数 `match(id, source, data)`。

**核心 API（match.js）**：

- `match(id, source, data)` → `Promise<AudioData>`
- `id`：网易云歌曲 id；`source`：音源数组（如 `["kugou", "kuwo", "bilibili", "pyncmd"]`，需显式传入以避免 `global.source` 副作用）；`data`：网易云歌曲信息（可省略，省略时 `find` 自动请求 song/detail 补全并缓存）
- 返回 `{ size, br, url, md5, source }`；失败抛 `SongNotAvailable` / `RequestFailed` 等，需 try-catch
- 行为开关（调用时读环境变量，沿用 docker-compose 命名）：`SELECT_MAX_BR`（并行取最高码率）、`FOLLOW_SOURCE_ORDER`（按序尝试）、`SEARCH_ALBUM`、`MIN_BR` 等

**结合点：song/url 响应后处理**（对渲染层完全透明，dev/prod 行为一致）：

```
GET /api/netease/song/url/v1?id=xxx
  → enhanced api 返回 { data: [{ code, url, br, freeTrialInfo, ... }] }
  → [UNM 后处理] 复刻 hook.js 判定：code !== 200 || freeTrialInfo || br < MIN_BR
      → await match(item.id, UNBLOCK_SOURCES.split(" "))
      → 成功：写回 item 的 url / br / size / md5，清除 freeTrialInfo
      → 失败：保持原响应，交给渲染层已有的多音源解灰调度兜底
  → 渲染层拿到即可播放，无需感知
```

**实现要点：**

- `server/unm/index.ts` 单文件封装（判定 + match 调用 + 响应改写），可整体开关（环境变量 `UNM_ENABLED`，默认开）
- 后处理只挂在 `song_url_v1`、`song_url`、`song_download_url` 等歌 URL 类动态路由上，其他接口零开销
- UNM 包为 CommonJS 无类型，新增 `server/types/unm.d.ts` 模块声明
- 渲染层**零改动**

**与现有解灰链路的关系（三层并行、互不冲突）：**

1. **UNM 服务端解灰（新增）**：song/url 响应替换，渲染层无感
2. **自实现 `/api/unblock/{netease|bodian|kuwo}`（迁移恢复）**：渲染层 `SongManager` 已有的多音源调度，UNM 未命中时兜底
3. **Docker hosts 劫持 + nginx sub_filter（现有）**：库级集成已确认可行，验证稳定后可移除 entrypoint 中的独立 UNM 进程与 hosts 劫持、简化 nginx sub_filter（作为后续简化项，不在本次范围强求）

**配置**：`UNBLOCK_SOURCES`（音源列表）、`MIN_BR`、`SELECT_MAX_BR`、`FOLLOW_SOURCE_ORDER`、`SEARCH_ALBUM`、`ENABLE_FLAC` 等沿用 docker-compose 现有命名，server 端统一读取

### 路由与代理设计（本地 / 生产一致）

- server 自身挂载完整路径：`/api/netease/*`、`/api/unblock/*`、`/api/qqmusic/*`
- 本地 dev：vite proxy `/api` → `http://127.0.0.1:3000`（不重写路径）
- Docker 生产：nginx `location /api/` → `proxy_pass http://localhost:3000`（不重写），保留 `/api/netease/song/url/v1` 的 `sub_filter` URL 改写与 `/music/unblock` 音频反代、hosts 劫持 + UnblockNeteaseMusic 进程（entrypoint 不变）
- 以后加自定义接口：在 `server/` 里加文件挂路由即可，dev/prod 同时生效

## 三、依赖排查结论

- `src/` 中**没有**任何对 `electron` / `@native/` / `@emi/` 的编译期 import（仅 `@opencc` 例外，需保留）
- 桌面分支全部由 `isElectron`（UA 检测）+ `window.electron` 运行时守卫，共约 **55 个文件**
- `/local` 路由有 `meta: { needApp: true }` 守卫，菜单入口由 `show: isElectron` 控制
- `electron/server/` 各模块对 Electron 的耦合极浅（logger / store / mainWindow），可低成本解耦

## 四、删除清单

### 目录

- `electron/` 整体删除，**但 `electron/server/` 的 netease、unblock、qqmusic 模块先迁移到新的 `server/` 目录**
- `native/external-media-integration/`、`native/taskbar-lyric/`、`native/tools/`（保留 `ferrous-opencc-wasm`）
- `windows/`（任务栏歌词窗口页面等）
- `web/loading/`（Electron 加载窗口页）

### 根文件

- `electron.vite.config.ts` → 改写为新的 `vite.config.ts`
- `electron-builder.config.ts`、`dev-app-update.yml`
- `Cargo.toml`、`Cargo.lock`（native 模块 workspace）
- `tsconfig.node.json`
- `scripts/dev.ts`、`scripts/build-native.ts`（保留 `scripts/sort-keywords.ts`，与桌面无关）

### CI（`.github/workflows/`）

- 删除：`dev.yml`、`release.yml`（桌面发布流程）
- 保留：`docker.yml`、`docs.yml`、`issue-helper.yml`、`stale.yml`

## 五、配置层改造

### 1. 新建 `vite.config.ts`（继承原 renderer 配置）

- 保留插件：`vue()`、`AutoImport`、`Components(NaiveUiResolver)`、`viteCompression`、`wasm()`（OpenCC 需要）
- 别名精简为：`@`、`@shared`、`@opencc`（删除 `@emi`、`@native`、`@windows`）
- build：入口仅 `index.html`（删除 loading、taskbar-lyric 入口），删除 `external: ["external-media-integration.node"]`，保留 terser / manualChunks / compression，`outDir: "dist"`
- server.proxy：`/api` → `http://127.0.0.1:${VITE_DEV_API_PORT || 3000}`（不重写路径，与 nginx 行为一致）
- preview：端口 `VITE_WEB_PORT`

### 2. 新建 `server/`（自建后端，本地与 Docker 共用）

- `server/index.ts`：Fastify 实例 + 挂载各模块（迁移自 `electron/server/index.ts`，去 Electron 化）
- `server/netease/`、`server/unblock/`、`server/qqmusic/`：从 `electron/server/` 原样迁移，`serverLog` 换为普通 logger
- 端口：默认 `3000`（可用环境变量覆盖）
- 运行：本地 `pnpm api`（`tsx server/index.ts`）；Docker `CMD` 直接跑同一个入口

### 3. `package.json`

- scripts：
  - `api`（新增）→ `tsx server/index.ts`
  - `dev` → `vite`
  - `build` → `pnpm typecheck:web && vite build`
  - `preview` → `vite preview`
  - `typecheck` → 仅保留 web 版（server 并入 node 工程检查或用 tsx 运行时兜底）
  - 删除：`build:native`、`typecheck:node`、`build:win/mac/linux`、`build:unpack`、`start`、`postinstall`
- 移除依赖（仅桌面使用）：`electron`、`electron-builder`、`electron-vite`、`electron-log`、`electron-store`、`electron-updater`、`better-sqlite3`、`ws`、`music-metadata`、`font-list`、`get-port`、`ajv`、`crypto-js`、`@electron-toolkit/*`、`@types/better-sqlite3`、`@types/ws`、`rimraf` 等
- **保留依赖**（server 需要）：`fastify`、`@fastify/cookie`、`@fastify/multipart`、`@neteasecloudmusicapienhanced/api`、`@unblockneteasemusic/server`（UNM 集成，改为项目依赖）、`change-case`、`axios`、`tsx`
- 保留核心：`vue`、`pinia`、`naive-ui`、`localforage`、`@vueuse/*`、`@applemusic-like-lyrics/*`、`@pixi/*`、`plyr` 等

### 4. 其他配置

- `tsconfig.json`：web 工程 + server 工程（或统一为一个）
- `pnpm-workspace.yaml`：仅保留 `"."`
- `env.d.ts`：删除 `MainEnv` 类型
- `.env.example`：`VITE_WEB_PORT=14558`、`VITE_DEV_API_PORT=3000`（新增）、`VITE_API_URL=/api/netease`
- `Dockerfile`：
  - 构建阶段：`npx electron-vite build` → `npx vite build`；`COPY /app/out/renderer` → `/app/dist`
  - 运行阶段：`CMD` 由 `npx @neteasecloudmusicapienhanced/api` 改为运行自建 `server/`；`@unblockneteasemusic/server` 改为项目依赖随 `pnpm install` 安装（不再全局安装）；entrypoint 的 hosts 劫持 + 独立 UNM 进程暂保留，待 UNM 库级集成验证稳定后作为简化项移除
- `nginx.conf`：`/api/netease/`、`/api/unblock/`、`/api/qqmusic/` 等归并为 `location /api/` 整体代理到 server（保留 song/url/v1 的 sub_filter 特殊处理）
- `README.md`：更新开发与部署说明

## 六、渲染层清理（约 55 个文件）

### A. 整文件 / 整目录删除（桌面专属）

- `src/core/audio-player/MpvPlayer.ts`
- `src/core/player/PlayerIpc.ts`
- `src/utils/initIpc.ts`、`src/utils/protocol.ts`
- `src/stores/shortcut.ts`（全局快捷键）
- `src/views/DesktopLyric/`、`src/views/Local/`
- `src/components/Modal/SongInfoEditor.vue`、`UpdateApp.vue`、`ScalingModal.vue`
- `src/components/Setting/config/local.ts`、`keyboard.ts`
- `src/components/Modal/Setting/FontManager.vue`（视其 web 降级分支而定，实现时判断删文件或清分支）
- 注：`src/api/qqmusic.ts` **保留**（配合自建 server 功能恢复）

### B. 保留文件、清理 isElectron 分支

- `core/player/`：AudioManager（引擎仅保留 element / ffmpeg）、AutomixManager、LyricManager、MediaSessionManager、PlayModeManager、PlayerController、SongManager
- `core/resource/`：CacheManager、DownloadManager
- `stores/`：music、setting（`window.api.store` 持久化分支 → 仅保留 localStorage/localforage 路径）等
- `components/`：Nav、Menu（删桌面菜单项）、DownloadModal、Equalizer、LoginCookie、AboutSetting、Setting/config/\*、FullPlayer、DefaultLyric、PlayerCover、PlayerRightMenu、AMLLServer、ExcludeLyrics、SidebarHideManager、CacheSizeLimit 等
- `composables/`：useInit、useListDataCache、useSongMenu
- `utils/`：env（删除 `isElectron` 导出）、auth、helper
- `main.ts`、`router/index.ts`（删除 `needApp` 守卫）、`layout/AppLayout.vue`

### C. 本地音乐 / 本地歌单

- 删除：本地歌曲（文件扫描）、本地歌手 / 专辑 / 文件夹视图及菜单入口、`stores/local.ts` 中本地歌曲扫描相关逻辑
- 保留：**本地歌单**（纯 localforage 数据，web 可用）；若实现时发现与删除项强耦合，将评估后说明处理结果

## 七、改造后的工作流

```bash
pnpm api        # 启动自建后端（127.0.0.1:3000，内含网易云 API + 解灰 + QQ 歌词接口）
pnpm dev        # 启动 vite（默认 14558），/api 自动代理到本地后端
pnpm build      # 类型检查 + 产出 dist/
docker compose up --build   # 生产部署（端口 25884）
```

## 八、验证步骤

1. `pnpm install`（更新 lockfile）
2. `pnpm lint`（0 错误 0 警告）
3. `pnpm typecheck:web`
4. `pnpm build`（vite 构建通过）
5. `pnpm api` + `pnpm dev` 手动验证：搜索 / 播放 / 歌词 / 设置
6. **UNM 解灰验证**：`curl "http://127.0.0.1:3000/api/netease/song/url/v1?id=<灰色歌曲id>&level=standard"`，确认返回的 url 非空且非试听片段
7. `docker build` 验证（可选）

## 九、已知影响

- 桌面专属设置项（任务栏歌词、SMTC、桌面歌词、全局快捷键、缩放等）从设置页移除
- dev 环境无 nginx 的 `sub_filter` URL 改写与 hosts 劫持，灰歌音源替换与生产略有差异（可走 `/api/unblock` 接口兜底）
- 持久化数据中残留的桌面配置字段不再读取（无害，不做迁移清理）
- 相比纯 npx 方案多维护约 300 行自建后端代码（绝大多数为现成代码迁移）
