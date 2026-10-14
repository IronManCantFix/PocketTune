# PocketTune 接入洛雪（LX Music）自定义音源 设计文档

日期：2026-10-14
状态：**已确认，实施中**
作者：AI 助手

## 已确认决策（2026-10-14）

| 决策点             | 结论                                           |
| ------------------ | ---------------------------------------------- |
| 代理白名单（§6.2） | 采用**动态登记 + 私网硬拦**                    |
| 脚本持久化（§6.3） | 新增 **`DATA_PATH`** 与 Docker 数据卷          |
| 功能范围           | **单用户 + 仅 `wy` 平台 + 默认关闭需手动开启** |

## 0. 背景与目标

需求：让 PocketTune 支持洛雪音乐（LX Music）的**自定义音源脚本**，扩展解灰能力。

参考项目：https://github.com/XCQ0607/lxserver

**关键认知（先纠正一个误解）**：

lxserver **不是**一个"音源列表"，而是：

1. LX Music 的**数据同步服务端**（歌单/收藏同步）；
2. 一套**完整的独立 Web 播放器**（自己的界面、Subsonic 协议、用户体系、跑在 9527 端口）；
3. 其中包含一个 **Node 侧洛雪自定义源脚本运行时**（vm2 沙箱）。

我们真正要的只有第 3 项。第 1、2 项与 PocketTune 完全重叠，引入等于同时跑两套播放器和两套账号体系，**坚决不做**。

**目标**：在 PocketTune 服务端实现一个**精简版洛雪源运行时**，把它作为**第三个解灰渠道**接入现有 `getUnlockSongUrl` 候选链，与现有 UNM 解灰、直连音源并存。

---

## 1. 现状盘点

### 1.1 现有两套音源机制

| 机制           | 位置                                | 音源集合                                                          | 是否可扩展  |
| -------------- | ----------------------------------- | ----------------------------------------------------------------- | ----------- |
| UNM 服务端解灰 | `server/unm/index.ts:8`             | kugou / kuwo / migu / bilibili / pyncmd（**硬编码白名单** `:32`） | ❌ 需改代码 |
| 直连回退音源   | `src/core/player/SongManager.ts:22` | netease(GD音乐台) / bodian / kuwo                                 | ❌ 需改代码 |

两者都由 `SongManager.getUnlockSongUrl()`（`src/core/player/SongManager.ts:198`）并发调度、按顺序取第一个成功项。

### 1.2 洛雪源与它们的本质差异

- UNM / 直连：**音频地址由服务端代码内置逻辑产出**，音源数量写死在数组里。
- 洛雪源：**音频地址由外部 JS 脚本产出**，脚本由用户导入，可无限扩展、可在线更新。

→ 这是"能不能扩展"的维度差异，洛雪源属于**运行时插件**，安全模型完全不同。

---

## 2. 洛雪源脚本契约（已实测确认）

### 2.1 脚本形态

标准脚本必须以 JSDoc 元数据开头，通过 `globalThis.lx` 与宿主通信：

```js
/*!
 * @name 示例音源
 * @version 1.0.0
 * @author xxx
 */
const { EVENT_NAMES, request, on, send } = globalThis.lx;

on(EVENT_NAMES.request, ({ source, action, info }) => {
  // action === 'musicUrl' 时必须返回 Promise<string>（直链）
  return Promise.resolve("http://xxx/a.mp3");
});

send(EVENT_NAMES.inited, {
  sources: {
    wy: {
      name: "网易云",
      type: "music",
      actions: ["musicUrl"],
      qualitys: ["128k", "320k", "flac"],
    },
  },
});
```

契约要点：

- `inited` 事件发出前发生任何错误 → 视为脚本加载失败；
- `on('request', handler)` 的 handler **必须返回 Promise**；
- 宿主通过 `lx.request` 提供**不受 CORS 限制**的 HTTP 请求（同步返回 cancel 函数，结果走 callback）。

### 2.2 实测：11 个真实洛雪源脚本的运行表现

用 vm2 + mock harness 实跑（脚本取自公开源仓库）：

| 脚本                   | `inited` 注册的平台  | 调 `musicUrl` 结果            |
| ---------------------- | -------------------- | ----------------------------- |
| qdy                    | wy,tx,kw,kg,mg,qsvip | ✅ 5/5 返回链接               |
| 独家音源(lx)           | kw,kg,tx,wy,mg,local | ✅ 返回链接（含加密签名）     |
| flower / grass / huibq | 5 平台               | ⚠️ 返回，但部分链接已 404/401 |
| huanyin                | tx,kw,wy,mg          | ✅ 走第三方聚合 API           |
| changqing              | kg,tx,wy,kw,mg       | ✅                            |
| juhe                   | —                    | ❌ 初始化失败                 |
| sixyin                 | —                    | ❌ 脚本自检拒绝加载           |
| ikun                   | kw,wy,**git**        | ⚠️ 平台名非标准               |

**结论：脚本质量参差严重（约 1/4 直接不可用），必须允许"导入多个、按优先级排队、失败的自动跳过"。**

### 2.3 API 面实测：比想象的小得多

用 Proxy 记录真实脚本实际访问的 `lx.*` 成员，结果：

```
lx.EVENT_NAMES
lx.on("request")
lx.send("inited")
lx.request
lx.currentScriptInfo      ← 仅"独家音源"用到
lx.utils.crypto.md5       ← 仅"独家音源"用到
```

→ **最小必需面 = `send` / `on` / `request` / `EVENT_NAMES` + `utils.crypto.md5`**。
`utils.buffer` / `utils.zlib` / `utils.crypto.aesEncrypt` / `rsaEncrypt` / `randomBytes` 属于低频扩展，一并实现成本极低（都是 Node `crypto` / `zlib` 直接转发），建议一次做全，避免脚本兼容性踩坑。

### 2.4 ⚠️ 致命契约差异：输入是「平台 songmid」，不是「网易云 id」

洛雪宿主向脚本传的 `info.musicInfo` 携带 **LX 平台标识 + 该平台内的 songmid**：

```js
{ source: 'wy' | 'kw' | 'tx' | 'kg' | 'mg', musicInfo: { songmid, name, singer, ... } }
```

而 **PocketTune 的歌曲只有网易云 `id`**（`SongType.id`，见 `src/types/main.ts:71`）。

实测验证：把网易云 id `185809` 当作 5 个平台的 songmid 一起传进去，脚本会照单全收地拼出：

```
http://97.64.37.235/flower/v1/url/wy/185809/320k     ← 可能对
http://97.64.37.235/flower/v1/url/kw/185809/320k     ← 语义错误
http://97.64.37.235/flower/v1/url/kg/undefined/320k  ← 直接 undefined
```

→ **设计定论：只使用 `source: 'wy'` 单平台调用。**
不传 kw/tx/kg/mg。原因：

1. PocketTune 没有其它平台的 id，伪造 id 只会得到错误结果或 `undefined`；
2. 网易云灰色歌曲恰恰在网易云自家的 wy 源上最容易命中；
3. 少传 4 个平台 = 少 4 倍无效外网请求。

这同时意味着：**洛雪源在 PocketTune 里的价值 = 一个「比 UNM 更新的网易云 wy 解灰通道」**，而不是"全平台聚合"。

---

## 3. 方案选型（已确认的决策）

| 决策点           | 选择                                         | 理由                                  |
| ---------------- | -------------------------------------------- | ------------------------------------- |
| 部署形态         | ❌ 不集成 lxserver 服务<br>✅ 自研精简运行时 | 避免双播放器 / 双账号体系             |
| 运行位置         | 服务端（Fastify）                            | 浏览器无法跑 Node 沙箱；且需绕过 CORS |
| 沙箱             | **vm2 安全模式，仅此一种**                   | 见 §6.1                               |
| 调用平台         | 仅 `wy`                                      | 见 §2.4                               |
| 在候选链中的位置 | 新增独立开关，默认在 UNM **之后**            | 不改变现有行为                        |
| 前端直链处理     | 复用 `/api/unblock/proxy`                    | 已有流式 + Range 透传                 |

---

## 4. 数据流

```
[前端 SongManager.getUnlockSongUrl]
      │  并发候选：bodian / netease / kuwo / 【lx】
      ▼
GET /api/unblock/lx?keyword=七里香-周杰伦&songmid=185809&songName=七里香&artist=周杰伦&quality=320k
      ▼
[server/lx/manager.ts]  按用户排序取启用的脚本，逐个尝试
      ▼
[server/lx/runtime.ts]  vm2 沙箱 → lx.send('inited') 注册平台
                        → lx.on('request') handler({ source:'wy', action:'musicUrl', info })
      ▼  脚本内部通过 lx.request 访问外部音源 API（脚本自带，非我们维护）
      ▼
返回直链 → validateReturnedMusicUrl() 校验（拒绝 404 / 试听片段）
      ▼
{ code: 200, url, source: 'lx', sourceName: '青灯音源' }
      ▼
[前端] toProxiedUrl(url) → /api/unblock/proxy?url=...
```

---

## 5. 改造清单与工作量

### 5.1 服务端新增（约 750 行）

| 文件                   | 行数 | 内容                                                                                               |
| ---------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `server/lx/types.ts`   | ~50  | `UserApiInfo`、`LxSourceMeta`、`LxApiInstance` 类型                                                |
| `server/lx/runtime.ts` | ~320 | vm2 沙箱、`lx` 对象构造（send/on/request/utils）、inited 等待、调用超时、`decontextify` 跨沙箱净化 |
| `server/lx/manager.ts` | ~230 | 脚本 CRUD、`sources.json` 持久化、加载/启用/排序、`getMusicUrl()` 候选轮询                         |
| `server/lx/index.ts`   | ~150 | Fastify 路由：list / upload / delete / toggle / reorder / validate                                 |

### 5.2 服务端修改（约 60 行）

| 文件                        | 改动                                                    |
| --------------------------- | ------------------------------------------------------- |
| `server/index.ts:65`        | 注册 `initLxAPI`                                        |
| `server/unblock/index.ts`   | 挂载 `/unblock/lx` 路由（与现有 bodian/kuwo 同级）      |
| `server/unblock/proxy.ts:8` | **白名单策略重写**（见 §6.2，这是整个方案最关键的改动） |
| `server/package.json`       | 加 `vm2@^3.12.2`                                        |

### 5.3 前端修改（约 220 行）

| 文件                                                 | 改动                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/types/main.ts:48`                               | `AudioSourceType` 增加 `"lx"`                                                                 |
| `src/core/player/SongManager.ts:22`                  | `SongUnlockServer` 枚举增加 `LX = "lx"`                                                       |
| `src/core/player/SongManager.ts:217`                 | lx 候选需携带 songmid/歌名/歌手                                                               |
| `src/api/song.ts:84`                                 | 新增 lx 相关 API（沿用 `/api/unblock` baseURL）                                               |
| `src/utils/helper.ts:380`                            | 代理域名白名单与 `AUDIO_SOURCE_LABELS` 同步                                                   |
| `src/components/Setting/components/LxSourceList.vue` | 新增：脚本导入/启用/拖拽排序（**复用 `StreamingServerList.vue` 的 UI 范式与 Naive UI 组件**） |
| `src/utils/modal.ts:452`                             | 新增 `openLxSourceManager()`                                                                  |
| `src/components/Setting/config/general.ts:135`       | 「音乐解锁」分组下新增一项                                                                    |
| `src/stores/setting.ts` + `settingMigrations.ts:191` | schema 版本 13 迁移                                                                           |

### 5.4 不动的部分

- Dockerfile：`pnpm deploy --filter=@pockettune/server` 会自动带上 vm2，**无需改构建**。
- nginx.conf：`/api/` 通配已覆盖新路由。

**总量估算：新增 ~750 行，修改 ~280 行。**

---

## 6. 三个必须解决的技术难点

### 6.1 难点一：沙箱安全（高风险，需你拍板）

vm2 是专门跑不受信任代码的沙箱，但**历史上 CVE 不断**（如 CVE-2023-37466 沙箱逃逸）。lxserver 自己也留了 `allowUnsafeVM` 逃生舱 —— 开启后直接换成 Node 原生 `vm`，**等于完全没有沙箱**。

**本方桉定的红线**：

1. **只实现 vm2 安全模式，不提供任何 unsafeVM 开关**；
2. 脚本加载时同步超时 10s；
3. `inited` 事件 `Promise.race` 等待 3s；
4. 单次 `musicUrl` 调用 `Promise.race` 超时 15s。

> ⚠️ 补充说明：vm2 的 `timeout` 选项**只约束同步代码**，脚本用 `setTimeout` / 未 resolve 的 Promise 可以把请求永久挂起。所以第 3、4 条的外部 race 是必需的，不能只依赖 vm2 自带 timeout。
>
> ⚠️ `lx.request` 必须在宿主侧强制超时（`response_timeout` 上限 60s）并限制重定向次数（`follow_max: 5`），否则沙箱内的脚本可以用一个慢速 URL 占住连接池。

### 6.2 难点二：媒体代理白名单与 SSRF（最容易踩死的地方）

现有 `server/unblock/proxy.ts` 是**硬编码域名后缀白名单**，`ALLOWED_HOST_SUFFIXES` 只有 9 项（`:8-18`），且兼职 SSRF 防御。

**实测：洛雪源脚本返回的直链域名，白名单内一个都没有**：

| 脚本产出的域名      | 现有白名单  |
| ------------------- | ----------- |
| `97.64.37.235`      | ❌ 拦截     |
| `music.haitangw.cc` | ❌ 拦截     |
| `api.xcvts.cn`      | ❌ 拦截     |
| `api.huibq.com`     | ❌ 拦截     |
| `api.lingchuan.com` | ❌ 拦截     |
| `kw-lv.kuwo.cn`     | ✅ 唯一放行 |

→ **不改白名单策略，洛雪源功能 100% 不可用。**

**推荐方案（动态登记 + 私网硬拦）**：

1. 维护进程内 `Set<string>` 动态域名白名单（上限如 200 个，LRU 淘汰）；
2. 每当洛雪脚本**成功解析出一个链接**，把该链接的 hostname 登记进去；
3. 代理只放行「静态白名单 ∪ 动态登记表」内的域名；
4. **私网拦截加固**：现有代码只做主机名前缀正则（`/^(localhost|127\.|10\.|192\.168\.|...)/`，`proxy.ts:52`），可被 `2130706433`、`0x7f.0.0.1`、IPv6 写法绕过。必须先 `dns.lookup` 解析出真实 IP，再校验 IP 是否落在私有网段，最后用**解析出的 IP 发起请求**（防 DNS rebinding）。

> 这一步的安全性直接等于"是否允许任意脚本让服务器去任意地址取任意内容"。**需要在实现前确认接受这个风险，或选择更保守的替代方案**（见 §9 待决问题）。

### 6.3 难点三：脚本持久化（Docker 下会丢）

现有配置存储 `server/netease/config-store.ts:8` 用的是 `join(tmpdir(), "splayer-server-config.json")` —— **临时目录，容器重启即丢**。

而 `docker-compose.yml` 当前**只挂载了 localtime / timezone，没有任何数据卷**。

→ 脚本文件（几十 KB 到数 MB）如果也放 tmpdir，**每次 `docker compose up -d --force-recreate` 后用户导入的脚本全部消失**。

**可选做法**：

- A. 新增 `DATA_PATH` 环境变量（默认 `./data`）存放脚本，compose 中加 `- ./data:/app/data`；
- B. 脚本内容随其他设置一起存入现有 config-store（同样会丢，但至少行为一致）；
- C. 本次先不解决，接受重启丢失（适合尝鲜用户，不适合正式发布）。

**建议 A**，但需要你确认是否愿意为此新增一个挂载卷（会改变部署文档）。

---

## 7. 质量映射表

| 洛雪 `qualitys` | 请求 `type` | PocketTune `QualityType` |
| --------------- | ----------- | ------------------------ |
| `128k`          | `128k`      | `LQ`                     |
| `320k`          | `320k`      | `HQ`                     |
| `flac`          | `flac`      | `SQ`                     |
| `flac24bit`     | `flac24bit` | `HiRes`                  |

现有设置的 `songLevel`（`standard/higher/exhigh/lossless/hires`）需按上表折算为洛雪 `type`，并**只从脚本 `inited` 声明的 `qualitys` 里取**，不支持的自动降级。

---

## 8. 与现有解灰渠道的关系（互斥）

**互斥，不共存。**

初始方案曾设计为"共存 + 洛雪源兜底"，后经确认改为**互斥**：用户要么用默认解锁源，要么用洛雪源。

### 8.1 为什么需要互斥

互斥前的实际行为比"共存"更差：`getUnlockSongUrl`（`src/core/player/SongManager.ts:233`）把所有 `enabled` 项放进 `Promise.allSettled` **并发触发**，再按拖拽顺序取第一个成功的。两边都开时：

- 每首歌都会发两路重复外网请求；
- 服务端 UNM 解灰（`server/unm/index.ts`）会**同时**改写网易云 `song_url` 响应，与洛雪源的结果来源重叠；
- 用户无法预知最终由哪条通道提供服务。

### 8.2 互斥的实现：三层保障

难点在于 **UNM 不在 `songUnlockServer` 列表里** —— 它是独立的服务端机制，仅靠前端开关联动盖不住。因此分三层：

| 层           | 位置                                              | 作用                                                                      |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------- |
| ① UI 联动    | `SongUnlockManager.vue`                           | 开启一边自动关闭另一边，并即时同步服务端                                  |
| ② 服务端开关 | `server/unm/index.ts` + `server/unblock/index.ts` | `PUT /api/unblock/mode` 写入 `unmDisabled`，`isUnmEnabled()` 据此停用 UNM |
| ③ 解析层兜底 | `SongManager.getUnlockSongUrl`                    | 若两方同时 enabled，强制只保留洛雪源，杜绝并发重复请求                    |

外加 `useInit.ts` 启动时回填模式，修复服务端重启后 `tmpdir` 配置丢失导致的状态不一致。

### 8.3 模式语义

- `mode = "default"`：启用 bodian / netease / kuwo 与**服务端 UNM 解灰**；
- `mode = "lx"`：仅启用洛雪源，**同时停用服务端 UNM 解灰**。

环境变量 `UNM_ENABLED=false` 为硬关闭，优先级高于运行时开关（此时洛雪源也无法反向启用默认解灰）。

### 8.4 验证结果

用耗时判定互斥是否真正生效（`rewriteSongUrlBody` 在停用时立即返回，不进入 UNM 网络匹配）：

| 模式      | 耗时      | 结论                     |
| --------- | --------- | ------------------------ |
| `lx`      | **0ms**   | 守卫短路，UNM 完全未参与 |
| `default` | **848ms** | UNM 实际执行了网络匹配   |

另验证：模式切换即时生效、非法值回落 `default`、`unmDisabled` 落盘并在重启后正确恢复。

---

## 9. 已确认决策（原待决问题）

1. ✅ **接受动态域名登记方案**（§6.2）。
2. ✅ **新增 `DATA_PATH` 与 Docker 数据卷**（§6.3）。
3. ✅ **同时支持在线导入与粘贴内容** —— 已实现两种方式，远程拉取限制 http/https、15s 超时、2MB 上限。
4. ✅ **按单用户实现**，不做用户体系。
5. ✅ **不做内置推荐源**。

---

## 10. 实施结果（已完成）

原计划的 7 步全部完成，并在真实脚本上验证。

### 10.1 实测中发现并修复的两个真实缺陷

这两个问题**照抄 lxserver 会一并继承**，是本项目独立实现的价值所在：

**缺陷一：AES 算法名拼接错误**

洛雪脚本对 `lx.utils.crypto.aesEncrypt` 的 `mode` 参数传法不统一：

- 多数脚本传裸模式名：`"cbc"` / `"ecb"`；
- **「六音音源」直接传完整算法名：`"aes-128-ecb"`**。

若按 lxserver 的 `aes-${key.length * 8}-${mode}` 拼接，会得到非法的 `aes-128-aes-128-ecb`，导致 `Unknown cipher` 报错。

修复：`resolveAesAlgorithm()` 检测到 `aes-` 前缀时直接采用完整名，否则才补 `aes-<位数>-` 前缀（见 `server/lx/runtime.ts`）。

**缺陷二：`form` 请求体未按 urlencoded 编码**

「六音音源」的网易云 eapi 请求使用 `form: { params: ... }`。若把该对象直接交给 axios，会被当作 JSON 序列化，upstream 返回空响应，脚本报 `failed`。

修复：`form` 显式用 `URLSearchParams` 编码并补 `Content-Type: application/x-www-form-urlencoded`。

**缺陷三（安全）：`198.18.0.0/15` 误判为内网**

初版把该段列入拦截（多数 SSRF 清单会收录），但实测发现本机 DNS 把**所有**域名解析到 `198.18.x.x` —— 这是 Clash / Surge 等代理软件 fake-ip 模式的默认段，在国内自建用户中极为普遍。

**若拦截该段，洛雪源对所有开启代理的用户 100% 失效**（连 `music.163.com` 都会被判为内网）。且该段并非本机或局域网地址，放行不会暴露内网服务。

修复：将其从黑名单移除，并在代码中注明原因（见 `server/unblock/ssrf.ts`）。

同时修复了一处 IPv6 绕过：`::ffff:7f00:1`（IPv4 映射的十六进制写法）原会被当作"不支持的地址"而非"内网地址"，现按 IPv4 规则正确复核。

### 10.2 验证矩阵

| 验证项                               | 结果                                   |
| ------------------------------------ | -------------------------------------- |
| 11 个真实洛雪脚本加载                | 10 个成功注册平台                      |
| 沙箱解析真实歌曲（网易云 id 185809） | ✅ 多脚本命中直链                      |
| SSRF 拦截用例                        | 21/21 通过（含 17 种私网/混淆写法）    |
| 代理放行策略                         | 未登记域名 400 / 内网 400 / 已登记放行 |
| 单脚本异常隔离                       | ✅ 进程存活，自动跳过                  |
| Docker 重启持久化                    | ✅ 脚本与启用状态均保留                |
| 多源优先级回退                       | ✅ 首选失败自动降级到次选              |
| 错误脚本导入                         | 4 类错误均返回可读中文提示             |
| `pnpm lint` / `format` / `typecheck` | 全部 0 错误 0 警告                     |

---

## 11. 风险与免责

- 洛雪源脚本来自第三方，**内容不可控**，可能包含恶意代码、窃取数据、或调用违法资源；
- 脚本可访问外网，**无法审计其请求内容**；
- 沙箱存在被绕过的理论风险（vm2 历史上有逃逸 CVE）；
- 与项目现有免责声明（`server/unblock/index.ts:40`）保持一致：仅供学习，不得传播或商用。

**已按此落实：功能默认关闭，`songUnlockServer` 中 `lx` 项默认 `enabled: false`；设置页顶部展示风险提示；不提供 lxserver 那样的 `unsafeVM` 逃生舱。**

---

## 12. 后续可选项（未实施）

- 脚本自动更新检查（`updateAlert` 事件，脚本已发送但当前忽略）；
- 脚本导入前静态扫描（检测 `require` / `process` 等敏感调用）；
- 洛雪源的 `lyric` / `pic` action 接入（当前仅用 `musicUrl`）。
