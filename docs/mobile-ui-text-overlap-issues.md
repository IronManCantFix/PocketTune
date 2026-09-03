# 移动端文字 / 元素遮挡问题清单（待决策）

> 本文档仅做问题汇总，未做任何代码改动。
> 检查范围：移动端（`<= 768px`、部分 `<= 990px / 810px / 512px`）UI 表现。
> 整体断点由 `src/composables/useMobile.ts` 定义：
>
> - `isSmall` < 512px
> - `isMobile` < 640px
> - `isSmallScreen` < 768px
> - `isTablet` < 990px
> - `isDesktop` >= 1024px

## 风险等级图例

- 🔴 **高**：在常见歌曲名 / 长文本场景下肉眼可见的遮挡、重叠或溢出。
- 🟠 **中**：依赖具体内容或屏幕尺寸才会出现，但已能定位到根因。
- 🟡 **低**：样式上不够优雅，移动端下视觉对齐略差，但不会丢信息。

---

## 一、全局 / 导航层

### 1.1 `src/components/Layout/Nav.vue` — 顶部导航在窄屏下布局拥挤 🟠

- 左侧 `<Logo v-if="!isDesktop" :size="40" />` + 主搜索框 + 用户 + 设置 + 移动端菜单按钮，并排放在一行 flex 容器里。
- `<SearchInp>` 移动端使用 `width: calc(100% - 150px)`（预留 150px 给右侧按钮），但在很窄的视口（<=380px）或开启 search mask 时（`width: calc(100% + 52px)`），与右侧“用户头像 + 设置 + 菜单按钮”发生挤压。
- 搜索框出现时还会触发 `.search-mask` 的全屏遮罩（`position: fixed`，`z-index: 100`），但 Nav 内的 `.page-control` / `.nav-main` 没有让位动画，搜索过程中 Logo 与右侧按钮仍叠在遮罩下层。
- 菜单按钮触发 `<n-drawer>` 宽度 240px，在 ≤320px 极窄屏几乎占满，可点击区域有限。

### 1.2 `src/components/Layout/Sider.vue` — 桌面侧边栏在移动端不会出现 ✅

- 仅 `isDesktop` 才渲染 `<n-layout-sider>`，移动端走 Drawer，OK。

### 1.3 `src/components/Layout/User.vue` — 用户头像点击区域 + 名称省略 ✅

- `<n-flex v-if="isDesktop">` 包裹用户名 + VIP + 下拉，桌面端正常。
- `.user-data` 有 `max-width: 200px`，但 `.user` 容器 `border-radius: 25px` + `background-color` 在移动端仍会显出圆形头像 + 占位，文字隐藏。整体可接受，列出以备整体改 header 头部布局时一起决定。

---

## 二、底部主播放器（Mini Player）

### 2.1 `src/components/Player/MainPlayer.vue` — 80px 高度里要塞完整信息 🔴

- 网格列 `1fr auto 1fr`，左侧 `.play-data` 包含：
  - 封面（56px，含播放图标）
  - 名称（`<TextContainer>` 跑马灯，固定字号 16px）
  - 倍速 tag（如 `1.25x`）
  - 喜欢 / 更多按钮
  - 实时歌词 / 艺术家（22px 高度，溢出隐藏）
- `.data` 里 `.name` 是 `flex: 0 1 auto`，没有显式 `min-width: 0`，歌名 + 倍速 + 喜欢 + 更多容易挤掉艺术家行；当前是 `.lyric-container` 直接覆盖在下面，肉眼看像「名字把歌词盖住」。
- 进度条 `top: -8px` 的绝对定位虽能展开，但和 `n-layout-toggle-bar` 等其它绝对定位元素同时存在时容易越界（仅在桌面可见）。
- 桌面 1024px 以下隐藏 `.time-container`，800px 以下隐藏 `.play-icon`（随机/循环按钮），但切换为图标的方式在移动端没有相应替代，只能通过控制条操作，对新用户不直观（🟡）。

### 2.2 `src/components/Player/PlayerRightMenu.vue` — 音质/均衡器/音量在 ≤810px 被隐藏 🟠

- `<= 810px` 时 `.menu-icon.hidden` 与 `.quality-tag.hidden` 全部 `display: none`。
- 这意味着移动端没有切音质、音量滑块入口，只剩播放列表按钮。
- 在用户反馈中常出现“找不到音量调节”，属于功能入口而非遮挡问题，但本次一并列出确认。

---

## 三、全屏播放器（Full Player）

### 3.1 `src/components/Player/FullPlayerMobile.vue` — 移动端竖屏全屏 🟠

- `.info-page` 使用 `padding: 0 24px 40px 24px`，`.cover-section` `margin-top: 60px` + `flex: 1` 自适应占位，在 iPhone SE（≤568px） 等机型上竖屏空间紧张，封面 + 进度 + 控制区可能溢出底部。
- `.song-info-bar` 中 `.info-section` 宽度通过 `:deep(.mobile-data) { max-width: 100%; .name { margin-left: 0; } }` 覆盖，但 `<PlayerData>` 默认 `.name` 字号 26px，移动端未降级，长标题在 `<= 380px` 仍然易超宽。
- `.control-section` 中 `.play-btn` 60px × 60px + 左右 ctrl-btn 50px + 模式按钮 40px，横屏 568px 以下高度仅 80px 时按钮纵向会与 `.progress-section` 重叠（依赖 `padding: 0 10px` 收窄）。
- 顶部 `.top-bar` `.btn` 靠右 padding 24px，关闭按钮可点区域偏小（🟡）。

### 3.2 `src/components/Player/PlayerMeta/PlayerData.vue` — 歌名/专辑/音源等文本字号偏大 🟠

- `.name-text` font-size 26px（full player 桌面），`.alia` 18px，`.ar-list` 16px，`.album .name-text` 16px。
- 在 `light` 模式（fullplayer mobile 当前是 `:light="false"`，未启用 light）会隐藏 alia，但 full mobile 仍显示。
- `.extra-info` 用 `position: absolute; right: -34px` 让云盘/解锁图标外移到右侧，在窄屏（<480px）会跑出卡片边界，被裁剪或被右侧控件盖住。
- `.play-meta` 横排 4 个 12px 的 meta-item（音质 / 歌词模式 / 音源），源标识最长可达 `Netease / Kuwo / Bodian / Local / Streaming` 等宽，长文本会横向挤压 `.ar-list`、`.album` 行。

### 3.3 `src/components/Player/PlayerMenu.vue` — 桌面顶部栏占位 🟠

- `.drag-dom { margin: 0 100px; height: 80px; flex: 1; -webkit-app-region: drag; }`。
- 在移动端 `<FullPlayerMobile>` 中并未使用此组件，所以不直接影响。但 **fullplayer 切回桌面模式** 或窗口被拉宽时，左右按钮仍存在，中间的 100px margin 占据了 1/5 屏幕的空白。
- 桌面专属代码可在桌面专属组件中隔离，本次先标注。

### 3.4 `src/components/Player/PlayerLyric/DefaultLyric.vue` — Pure 模式内边距过大 🔴

- `.pure .lyric-scroll-container { padding: 0 80px; }`，纯歌词模式下左右各 80px，在 ≤480px 视口仅剩 ~320px 实际歌词宽度，长歌词会被强制换行甚至截断。
- `.lrc-line .content` 用 `overflow-wrap: anywhere`，虽然能换行但 80px padding 浪费空间，且与左右背景动效结合后视觉拥挤。
- 倒计时 `.point` 在 ≤700px 缩为 20px（OK），但 `.countdown-line` 高度未变。
- `.lyric-loading` font-size 22px 全局不缩。

---

## 四、列表 / 卡片

### 4.1 `src/components/List/SongList.vue` + `src/components/Card/SongCard.vue` — 歌曲行 🔴

- 列表表头（`.list-header`）在 `isSmallScreen` 下隐藏“专辑 / 更新日期 / 播放量 / 时长 / 大小”，仅保留“#、标题、操作”。
- `.actions` 仍然渲染 40px 列，但卡片内改为 `SvgIcon name="More"`（更多菜单），OK。
- **但** SongCard 行内 `.desc` 横向布局包含若干 n-tag：音质、原唱、翻唱、VIP / EP、云盘、MV、E（脏标）、别名 `(...)`，加上 `.artists`。若该歌曲既有原唱又有 VIP 又有云盘 MV，标签会挤掉艺人名 / 换行到第二行。
  - `.desc { min-width: 0; }` 已在，但 `n-flex :size="4" :wrap="false"` 强制不换行 → 内容溢出 → 文字截断或艺术家被截。
  - 这是 **歌单行最常见的视觉问题**。
- SongCard 高度 90px，在 ≤480px 设备上 `.desc` 容纳不了双行时会被压缩。
- 表头 `.title` flex 1，`&.has-sort::after` 的 `left: -8px; width: 100%` hover 高亮带会越过左边界 8px，与序号列重叠（仅桌面）。

### 4.2 `src/components/List/ListDetail.vue` — 列表页头部详情 🟠

- 桌面 240px 高度，移动端 180px，`.small`（滚动收起）时 120px。
- `.menu` 内包含：播放按钮（40px 高）+ 插槽按钮 + 更多按钮 + 模糊搜索（130px，focus 后 200px）+ Tabs（200px，宽屏显示）。
- `@media (max-width: 1200px) { .right { display: none } }` 隐藏右侧搜索/tabs，但 `.menu` 的 `position: absolute; bottom: 0; width: 100%`，在 ≤768px 没有进一步缩窄按钮高度的处理（已经缩到 34px、13px 字体了）。
- `.meta .tags` 是一组 n-tag，使用 `n-flex class="tags"`，但 `.tags` 没有 `flex-wrap: wrap`，长歌单标签会把 `.item` 拉宽导致横向挤压其它行。
- `.description` 单行隐藏但点击会展开 modal，OK。

### 4.3 `src/components/Card/SongListCard.vue` — 主页推荐卡片 🟠

- 移动端 `HomeOnline.vue` 中 `.rec-list` 改为 `grid-template-columns: repeat(2, 1fr)`，每张 card 高度 90px。
- card 内部 `.cover` 没显式宽度（只 `margin-right: 20px; aspect-ratio: 1/1`），容器宽度不够时封面会被压缩为 0、文字被挤。
- 详情行 `.name` 18px 字号，`.info` 内空间紧张时（grid 间距 20px）标题与描述同行隐藏正常，但图标 `.play` 默认隐藏仅 hover 显示，移动端无 hover 故播放入口不可见（🟡 功能问题）。

### 4.4 `src/components/Player/PlayerComponents/PersonalFM.vue` — 私人 FM 卡片 🟠

- 桌面 200px 高、160px 封面、22px 歌名、14px 艺术家、14px 专辑、底部 4 个按钮。
- 移动端（≤768px）改为 120px 高，80px 封面，16px 歌名，`.album` 隐藏，菜单 `margin-top: 8px`。
- 120px 中要塞：封面 + 16px 歌名 + 14px 艺术家 + 8px + 控制按钮行（`.play` 36px / `.menu-icon` 26px），竖直方向非常紧张，长艺术家名会撑破 120px。
- `.radio` 在 ≤1200px 且 ≥769px 隐藏，移动端又会显示，与 `.menu` 控制按钮会重叠。

### 4.5 `src/components/List/CoverList.vue` — 歌单 / 视频卡片网格 🟠

- 默认 `repeat(auto-fill, minmax(160px, 1fr))`，移动端 ≤600px 改为 3 列（`repeat(3, 1fr)`）。
- `.cover-data .name` 16px、`-webkit-line-clamp: 2`，长名称在 3 列窄宽下会折行 2 行正常，但 `.artists`（视频类）横排可能挤出右边界。
- `.cover-data` 没有 `min-width: 0`，长 playlist 名 + creator 行内 `<n-text class="creator">` 在小屏会把容器撑出去（不明显但有风险）。
- `.play-btn` 默认 hover 才出现，移动端无 hover 导致播放入口缺失。

### 4.6 `src/components/List/ArtistList.vue` — 歌手网格 🟡

- 同 CoverList，3 列 + 圆形封面，长名 `.name` 单行省略（OK）。`.num` 含 `Music` 图标 + 数字，单行展示，没问题。

### 4.7 `src/components/List/CommentList.vue` — 评论列表 🟡

- `.comments` 圆角 + flex 横向 `.user`（60px 宽）+ `.data`（flex: 1）。
- `.data` 用 `flex: 1; width: 100%`，内部 `.content` 包含用户名 + `：` + 评论文本（white-space: pre-wrap，user-select: text）。文本会按容器宽度换行，OK。
- `.reply` 嵌套评论宽度 100%，padding 4px 8px，OK。
- `.meta` 横向（时间 / IP / 抱一抱 / 点赞），长 IP 定位（`广东 深圳`）加上点赞数 `9999+`，在 ≤380px 宽度下会换行（依赖 n-flex 默认 wrap=false，可能造成单行高度异常）。

---

## 五、视图页面

### 5.1 `src/views/DailySongs.vue` — 每日推荐标题字号 🔴

- `.title .name { font-size: 55px; }` 居中标题，移动端未缩到 24~28px，常见 iPhone (375px) 会被裁切 + 触发水平滚动条（如果外层没 overflow:hidden）。
- `.title { height: 300px; }` 也偏大，移动端仅用 `flex-direction: column` 仍占 300px。

### 5.2 `src/views/Cloud.vue` — 云盘页头 🟠

- `.title` 中 `.keyword` 30px + `.status`（数量 + 进度条）。在 ≤480px 时两段并排会被挤压，进度条 `width: 80px`、`.space` 默认隐藏 OK。
- `.menu` 三个按钮 + 130px 搜索框，未做响应式，宽度不够时会被挤出。

### 5.3 `src/views/History.vue` — 最近播放页头 🟠

- `.title .keyword` 30px + `.size` 15px，OK。
- `.menu` 两个按钮高度 40px，未做响应式。

### 5.4 `src/views/Video.vue` — 视频详情 🟠

- `.info .name` 28px，移动端未缩。
- `.menu` 横向 `.artist` (含 40px 头像 + 双行名字 + "查看详情" hint) + 三个 quaternary 按钮（点赞/收藏/分享），≤480px 容易挤压；`.artist .name::after { content: "查看详情"; }` 强制副文本，移动端无法隐藏。
- `.comment .tag` 中 `n-tag` 数量有限，但 h3 标题 `.n-h3 prefix="bar"` 前缀 + 评论数 + tabs 行在窄屏还行。
- Plyr 控件 `controls` 一长串（10+ 按钮），iOS Plyr 会隐藏部分，但 Android Chrome 仍可能全显示，遮挡视频。

### 5.5 `src/views/Comment.vue` — 评论页歌曲信息条 🟠

- `.song-data` 横向（封面 + 歌名 + 艺术家 + 两个 icon 操作）。
- `.song-info` 没有 `flex: 1; min-width: 0`，且 `<n-flex :wrap="false">` 强制单行，长歌名会把右侧 `.actions` 挤出。
- `.actions` 内两个 40px 按钮 + `margin-left: auto`，被挤出后会被截断。

### 5.6 `src/views/Discover/layout.vue` — 发现页 🟠

- `.title .keyword { font-size: 30px; }` 未做响应式。
- `n-tabs` 6 个 tab（歌单广场 / 排行榜 / 歌手 / 最新音乐），在窄屏宽度不够时 `n-tabs` 默认会换行显示（取决于 Naive UI 的 `justify-content`），可能导致标题与 tabs 重叠（🟡）。

### 5.7 `src/views/Discover/playlists.vue` — 分类标签 🟠

- 顶部分类按钮（带 `catName` 长名如「华语｜古风｜跨界）+ 精品 tabs 140px 宽；分类名过长时按钮文字溢出。
- 弹窗中 n-tag 分类（语种 / 风格 / 场景 / 情感 / 主题）数量多，n-flex 默认不换行可能在窄屏溢出（依赖父级 .cat-list）。

### 5.8 `src/views/Like/layout.vue` — 我的收藏 🟠

- `.title .keyword { font-size: 30px; }` + 5 个数量统计项；≤512px 已经把 `.status` 隐藏，OK。
- `n-tabs` 5 个 tab（歌单 / 专辑 / 歌手 / 视频 / 播客），≤512px 切换为 `type="line"`（OK）。>512px 是 `segment` + 圆角，可能宽度不够。

### 5.9 `src/views/Search/layout.vue` — 搜索结果页 🔴

- `.title .keyword { font-size: 36px; }`，长搜索词会撑爆甚至与 “的相关搜索” 重叠。
- `n-tabs` 6 个 tab（单曲 / 歌单 / 歌手 / 专辑 / 视频 / 播客），在 ≤480px 时极易超出 `n-tabs` 容器宽度，默认换行（多行 tabs）。

### 5.10 `src/views/Song/wiki.vue` — 歌曲百科 🟠

- `.header .name { font-size: 30px; }` 桌面，移动端 `@media (max-width: 600px)` 改为纵向居中布局，但字体未缩（仍是 30px）。
- `.data .meta` 内 `.item` 横向 `flex-wrap: nowrap` + 嵌套 `n-text.text-hidden`，长艺术家名 + 专辑名会单行截断。

---

## 六、Modals / Drawer / Popover

### 6.1 `src/components/Modal/Login/Login.vue` — 登录弹窗 🟠

- `.logo` 60×60 OK。
- `.other` 中两个 `n-button` `width: 140px`（固定宽度），≤360px 视口会被压或换行。
- 弹窗由 `openUserLogin` 用 `n-modal` 渲染，全局 `.n-modal { max-width: calc(100vw - 40px) }` 已生效，OK。

### 6.2 `src/components/Modal/Login/LoginPhone.vue` — 手机登录表单 🟠

- `n-input-number` + 验证按钮（`.send` `margin-left: 12px`），在 ≤320px 输入框 + 按钮宽度合计超出 `n-form-item`。
- “获取验证码” / “60s” 文字在窄屏会被压缩。

### 6.3 `src/components/Modal/ChangeRate.vue` — 倍速调节 🟠

- 8 个 `size="large"` n-tag（`0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2`）横排，`n-flex align="center" justify="center"` 但 `size="large"` 标签宽度大，≤480px 必然换行（依赖 Naive UI 行为），且文字可能与 `n-slider` 顶部 marks 文字 (`0.2x / 1x / 2x`) 视觉重叠。

### 6.4 `src/components/Modal/Setting/MainSetting.vue` — 设置弹窗 ✅

- 已有完整 768px 响应式（侧栏抽屉 + 标题栏），OK。

### 6.5 `src/components/Menu/MobileSongMenu.vue` — 移动端歌曲菜单 Drawer ✅

- 高度 50vh，header 包含封面 48px + 歌名 + 艺术家，自动省略，OK。

### 6.6 `src/components/Search/SearchInp.vue` + `SearchDefault.vue` + `SearchSuggest.vue` — 搜索框 🟠

- 搜索建议/历史卡片在桌面宽 300px，移动端改为 `width: 100%`，OK。
- 但 `position: absolute; left: 0; top: 50px` 与移动端 `&.focus { left: -52px; width: calc(100% + 52px); }` 配合，外溢 52px 实际会延伸到屏幕外 52px，会被父容器裁掉 OK（Nav 内 `overflow:hidden`），但 `right: 0` 端的“用户头像”可能被遮罩盖住（视觉上看像按钮消失）。

---

## 七、Setting / 列表内部 Modal

### 7.1 `src/components/Setting/MainSetting.vue` 内 `.set-item` 🟡

- `.set { width: 200px; min-width: 200px; }` 在 ≤768px 缩到 140px；`.n-flex { flex-flow: nowrap !important }` 强制单行，部分长 option 下拉 / 多开关控件会横向挤压 `.label`。
- label 内容含 `.name`（16px）+ 描述 / 额外内容，长 label 时无 ellipsis。

### 7.2 `src/components/Modal/ABLoop.vue` / `AutoClose.vue` / `Equalizer.vue` 等未读源码，建议一并目测（留作待办）。

---

## 八、其他可优化的全局样式

### 8.1 `src/style/main.scss`

- `.n-tabs { width: 100% }` OK。
- `.text-hidden { line-clamp: 1; -webkit-line-clamp: 1; }` 单行省略工具类常用，OK。
- `.n-modal { max-width: calc(100vw - 40px) }` 全局 modal 宽度保护，OK。

### 8.2 `src/components/Global/TextContainer.vue`

- 跑马灯容器 `width: 100%; overflow: hidden`，OK。
- 但 `<TextContainer>` 内部的父元素需要有明确高度限制（MainPlayer 信息行已有 `overflow: hidden`，FullPlayer 桌面正常）。

---

## 九、问题影响面汇总（请决策优先级）

| 区域             | 关键问题                                     | 风险等级 | 备注            |
| ---------------- | -------------------------------------------- | -------- | --------------- |
| MainPlayer       | 歌名 + 倍速 + 喜欢 + 更多挤压艺术家 / 歌词行 | 🔴       | 80px 高度内容多 |
| SongCard         | 多个 tag 横排导致艺术家被截                  | 🔴       | 需 flex-wrap    |
| Search layout    | 关键词 36px + 6 个 tabs 溢出                 | 🔴       | 标题字号 + tabs |
| DailySongs       | 55px 标题 + 300px title 区                   | 🔴       | 移动端缩放      |
| DefaultLyric     | Pure 模式左右 80px padding                   | 🔴       | 窄屏歌词宽度    |
| Video / Wiki     | 标题 28~30px 未缩                            | 🟠       | 移动端适配      |
| Cloud / History  | 头部按钮 + 搜索框挤                          | 🟠       | 需 flex-wrap    |
| FullPlayerMobile | `.extra-info` 跑出右边                       | 🟠       | 绝对定位        |
| PlayerData       | `.play-meta` 横向多项                        | 🟠       | 4 个 meta-item  |
| Discover layout  | 6 个 tabs 拥挤                               | 🟠       | tab 换行        |
| MainSetting      | `.set-item` `.set` 140px 仍紧                | 🟡       | 部分长控件      |
| PlayerMenu       | `.drag-dom` 占 100px margin                  | 🟡       | 仅桌面          |

---

## 十、建议的下一步

1. 确认上面表格中 🔴 高风险项是否纳入本期修复（建议至少 MainPlayer / SongCard / DailySongs / DefaultLyric / Search layout）。
2. 🟠 中风险项可按视图重要度选择。
3. 🟡 低风险项视动效/排期。
4. 修复方案需注意：
   - 遵循 `src/composables/useMobile.ts` 的统一断点。
   - 复用现有 `.text-hidden` / Naive UI 组件，不引入新依赖。
   - 修改后跑 `pnpm lint` + `pnpm build`。
   - 在 dev server 启用 Playwright / 模拟移动视口自测。

如确认方案后，再据此进入修复阶段。
