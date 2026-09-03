<div align="center">
<img alt="logo" height="100" width="100" src="public/icons/favicon.png" />
<h1> PocketTune </h1>
<p> 适配移动端 / NAS 部署的纯 Web 网易云音乐客户端 </p>
</div>

## 📌 项目说明

本项目是 [SPlayer-Dev/SPlayer](https://github.com/SPlayer-Dev/SPlayer)（原作者 [imsyy](https://github.com/imsyy)）的一个 **Fork**。

首先要**特别感谢原作者** `imsyy` 开发了 SPlayer 这个非常出色的音乐播放器。我一直在寻找一个在移动端适配良好、并且可以登录网易云音乐的 Web 音乐客户端，而 SPlayer 做得非常好，完全符合我的需求。

我 Fork 这个项目的主要目的是：**在自己的 NAS 上部署一个纯 Web 的音乐客户端**，这样在飞牛 (FeiNiu) 系统中，就可以像使用普通 Web 应用一样直接在飞牛 App 里访问网易云音乐，而无需额外安装桌面端程序。

### 🎯 我的使用场景

1. **NAS 部署**：通过 Docker 一键部署到我的 NAS 上，浏览器即可访问
2. **飞牛 (FeiNiu) 访问**：在飞牛 App 内直接打开 Web 界面，随时随地听歌
3. **移动端优先**：重点优化手机 / 平板上的浏览和播放体验
4. **网易云音乐登录**：完整保留并重点验证扫码 / 手机号登录能力

### 🔧 本 Fork 的主要改动（相比原项目）

> 改造目标：把项目从「桌面客户端 + Web」混合形态，精简为「纯 Web、优先移动端、面向 NAS 部署」。

- **移除桌面端打包**：彻底移除 `Electron` 桌面端及相关代码
  - 删除 `electron/` 全部代码（主进程、preload、IPC、窗口管理、系统托盘等）
  - 删除 `native/` 下的 Rust 原生模块（任务栏歌词、外部媒体集成、本地扫描等）
  - 删除桌面端才需要的能力：Windows 任务栏歌词、Discord RPC、本地播放器 (mpv)、本地音乐管理等
  - 移除首次打开时的用户协议弹窗
- **切换为纯 Web 部署**：支持 Docker / Vercel / 静态托管
  - 原 `electron/server` 改为独立的 `server/`（Fastify 后端），随 Docker 镜像一起分发
  - 保留并支持 `pnpm api` 本地启动后端
  - Docker 镜像内已包含前端 `dist/` 产物 + 后端服务，默认监听 `25884` 端口
- **优化移动端 UI 适配**：
  - 播放器：歌名 / 喜欢 / 更多按钮不再挤压艺术家信息；全屏播放器禁止左右滑动拖动，仅通过指示器切换
  - 卡片：`SongCard` 多标签横排改为自动换行
  - 标题字号：`DailySongs` 标题移动端由 55px 缩为 30px，避免溢出
  - 搜索：关键词 36px + 6 个 tab 在窄屏下的溢出问题修复
  - 歌词：`DefaultLyric` Pure 模式 80px padding 窄屏缩为 20px
  - 安全区：底部播放器适配 iOS 底部安全区消除白线，顶部导航适配 iOS 顶部 Safe Area 避让刘海
  - 各页面（Video / Comment / Wiki / Discover / Cloud / History / Like）移动端标题字号与菜单适配
  - 云盘页标题改为自适应高度，避免被顶部搜索栏遮挡
- **CI / 部署调整**：
  - Docker 镜像改为推送到 `ghcr.io`（删除 Docker Hub 步骤）
  - 部分桌面端依赖、构建脚本与配置文件删除

如需关注移动端待优化问题，可参考 `docs/mobile-ui-text-overlap-issues.md` 问题清单。

### ⚠️ 说明

- 底部为**原项目 (SPlayer) 的 README**，内容未做改动，仅用于保留原始使用说明与文档
- 本项目遵循原项目的 **AGPL-3.0** 开源许可，使用时请遵守相关条款
- 本 Fork 为个人自用并对外开源，如有相关建议或改进，欢迎提交 Issue / PR

---

> 以下内容为**原项目 SPlayer 的 README**，保留原样，仅供参考

---

> [!CAUTION]
>
> # 本项目进入维护模式
>
> 项目已进入维护模式，后续仅进行必要的维护与重大问题修复，不再主动开发新功能
>
> 新功能及后续版本请移步 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next)

<div align="center">
<img alt="logo" height="100" width="100" src="public/icons/favicon.png" />
<h2> SPlayer </h2>
<p> 一个简约的音乐播放器 </p>

[API Docs](https://splayer.imsyy.top/api.html) | [开发版](https://github.com/imsyy/SPlayer/actions)

<br />

[![Stars](https://img.shields.io/github/stars/imsyy/SPlayer?style=flat)](https://github.com/imsyy/SPlayer/stargazers)
[![Version](https://img.shields.io/github/v/release/imsyy/SPlayer)](https://github.com/imsyy/SPlayer/releases)
[![License](https://img.shields.io/github/license/imsyy/SPlayer)](https://github.com/imsyy/SPlayer/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/imsyy/SPlayer)](https://github.com/imsyy/SPlayer/issues)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/imsyy/SPlayer)

</div>

![main](/screenshots/SPlayer.jpg)

## 说明

![提示](/screenshots/gitcodes.png)

> [!IMPORTANT]
>
> ### 严肃警告
>
> - 请务必遵守 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可协议
> - 在您的修改、演绎、分发或派生项目中，必须同样采用 **AGPL-3.0** 许可协议，**并在适当的位置包含本项目的许可和版权信息**
> - 若您用于售卖或其他盈利用途，**必须提供本项目的源代码及原项目链接**。另外由于本项目涉及第三方，**售卖后可能遭受法律或诉讼风险**。如若发现违反许可协议，作者保留追究法律责任的权利
> - 禁止在二开项目中修改程序原版权信息（ 您可以添加二开作者信息 ）
> - 感谢您的尊重与理解

- 本项目采用 [Vue 3](https://cn.vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) + [Naïve UI](https://www.naiveui.com/) 开发，本地后端基于 Fastify 提供 API 服务
- Node.js 版本要求：>= 20，包管理器：pnpm >= 10
- 支持网页端部署（Docker / Vercel / 静态托管），也可使用 `pnpm api` 在本地运行后端服务
<!-- - 仅对移动端做了基础适配，**不保证功能全部可用** -->

<!--  > 请注意，本程序不打算开发移动端，也不会对移动端进行完美适配，仅保证基础可用性 -->

- 欢迎各位大佬 `Star` 😍

## 🧑‍💻 开发

### 快速开始

1. 安装依赖：`pnpm install`
2. 复制 `.env.example` 为 `.env` 并按需修改
3. 启动本地后端：`pnpm api`
4. 启动前端开发服务器：`pnpm dev`
5. 构建：`pnpm build`（产物输出至 `dist/` 目录）

## 👀 Demo

- 在线演示：[SPlayer](https://splayer.20100907.xyz)

  > 如打不开，说明已经失效请自行前往 [获取](#️-获取)

## 🎉 功能

- ✨ 支持扫码登录
- 📱 支持手机号登录
- ~~📅 自动进行每日签到及云贝签到~~
- 🎨 封面主题色自适应，支持全站着色
- 🌚 Light / Dark / Auto 模式自动切换
- 📁 本地歌单（浏览器本地数据，离线可用）
- ➕ 新建歌单及歌单编辑
- ❤️ 收藏 / 取消收藏歌单或歌手
- ☁️ 云盘音乐上传
- 📂 云盘内歌曲播放
- 🔄 云盘内歌曲纠正
- 🗑️ 云盘歌曲删除
- 🌐 支持 Subsonic / Navidrome 等流媒体服务（多服务器支持、自动连接）
- 📝 支持逐字歌词
- 🔄 歌词滚动以及歌词翻译
- 📹 MV 与视频播放
- 🎶 音乐频谱显示
- ⏭️ 音乐渐入渐出
- 🔄 支持 PWA
- 💬 支持评论区
- 🎵 支持 Last.fm Scrobble（播放记录上报）
- 📱 移动端基础适配

## 🖼️ 界面展示

> 开发中，仅供参考

<details>
<summary> 主页面 </summary>

![主页面](/screenshots/SPlayer%20-%20主页面.jpg)

</details>

<details>
<summary> 播放页面 </summary>

![播放页面](/screenshots/SPlayer%20-%20播放页面.jpg)

</details>

<details>
<summary> 发现页面 </summary>

![发现页面](/screenshots/SPlayer%20-%20发现页面.jpg)

</details>

<details>
<summary> 歌单页面 </summary>

![发现页面](/screenshots/SPlayer%20-%20歌单页面.jpg)

</details>

<details>
<summary> 评论页面 </summary>

![发现页面](/screenshots/SPlayer%20-%20评论页面.jpg)

</details>

## 📦️ 获取

### 自行部署方案

#### ⚙️ Docker 部署

> 安装及配置 `Docker` 将不在此处说明，请自行解决

##### 本地构建

> 请尽量拉取最新分支后使用本地构建方式，在线部署的仓库可能更新不及时

```bash
# 构建
docker build -t splayer .

# 运行
docker run -d --name SPlayer -p 25884:25884 splayer
# 或使用 Docker Compose
docker-compose up -d
```

Docker 镜像内包含网页端以及运行所需的服务，默认通过 `25884` 端口访问。

##### 在线部署

```bash
# 从 Docker Hub 拉取
docker pull imsyy/splayer:latest
# 从 GitHub ghcr 拉取
docker pull ghcr.io/imsyy/splayer:latest

# 运行
docker run -d --name SPlayer -p 25884:25884 imsyy/splayer:latest
```

以上步骤成功后，将会在本地 [localhost:25884](http://localhost:25884/) 启动，如需更换端口，请自行修改命令行中的第一个端口号

#### ⚙️ Vercel 部署

> 其他部署平台大致相同，在此不做说明

1. 本程序依赖 [NeteaseCloudMusicApi](https://github.com/neteasecloudmusicapienhanced/api-enhanced) 运行，请确保您已成功部署该项目或兼容的项目，并成功取得在线访问地址
2. 点击本仓库右上角的 `Fork`，复制本仓库到你的 `GitHub` 账号
3. 复制 `/.env.example` 文件并重命名为 `/.env`
4. 将 `.env` 文件中的 `VITE_API_URL` 改为第一步得到的 API 地址

   ```js
   VITE_API_URL = "https://example.com";
   ```

5. 将 `Build and Output Settings` 中的 `Output Directory` 改为 `dist`（仓库已通过 `vercel.json` 配置，通常无需手动修改）

   ![build](/screenshots/build.jpg)

6. 点击 `Deploy`，即可成功部署

#### ⚙️ 服务器部署

1. 重复 `⚙️ Vercel 部署` 中的 1 - 4 步骤
2. 克隆仓库

   ```bash
   git clone https://github.com/imsyy/SPlayer.git
   ```

3. 安装依赖

   ```bash
   pnpm install
   ```

4. 编译打包

   ```bash
   pnpm build
   ```

5. 将站点运行目录设置为 `dist` 目录（后端 API 服务需另行部署，可参考上方 Docker 部署方案）

#### ⚙️ 本地部署

1. 本地部署需要用到 `Node.js`（>= 20），可前往 [Node.js 官网](https://nodejs.org/zh-cn/) 下载安装包，请下载最新稳定版
2. 安装 pnpm（>= 10）

   ```bash
   corepack enable
   # 或
   npm install pnpm -g
   ```

3. 克隆仓库并拉取至本地，此处不再赘述
4. 使用 `pnpm install` 安装项目依赖（若安装过程中遇到网络错误，请使用国内镜像源替代，此处不再赘述）
5. 复制 `.env.example` 文件并重命名为 `.env` 并修改配置
6. 构建网页端

   ```bash
   pnpm build
   ```

   构建完成后，静态产物将输出至 `dist` 目录，可将其部署至任意静态服务器；后端 API 服务可使用 `pnpm api` 启动，或参考上方 Docker 部署方案

## 😘 鸣谢

特此感谢为本项目提供支持与灵感的项目：

- [NeteaseCloudMusicApi](https://github.com/neteasecloudmusicapienhanced/api-enhanced)
- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server)
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics)
- [Vue-mmPlayer](https://github.com/maomao1996/Vue-mmPlayer)
- [refined-now-playing-netease](https://github.com/solstice23/refined-now-playing-netease)
- [material-color-utilities](https://github.com/material-foundation/material-color-utilities)

## 🗺️ 贡献者联盟

欢迎加入我们 🥰! 一起为 SPlayer 贡献一份力量。
感谢以下所有贡献者 💖

<a href="https://github.com/imsyy/SPlayer/graphs/contributors" target="_blank" rel="noopener">
  <img src="https://contrib.rocks/image?repo=imsyy/SPlayer&max=30&anon=1&v=1"
    alt="SPlayer 项目贡献者"
    width="650"
    loading="lazy"
  />
</a>

## 📢 免责声明

本项目部分功能使用了网易云音乐的第三方 API 服务，**仅供个人学习研究使用，禁止用于商业及非法用途**

同时，本项目开发者承诺 **严格遵守相关法律法规和网易云音乐 API 使用协议，不会利用本项目进行任何违法活动。** 如因使用本项目而引起的任何纠纷或责任，均由使用者自行承担。**本项目开发者不承担任何因使用本项目而导致的任何直接或间接责任，并保留追究使用者违法行为的权利**

请使用者在使用本项目时遵守相关法律法规，**不要将本项目用于任何商业及非法用途。如有违反，一切后果由使用者自负。** 同时，使用者应该自行承担因使用本项目而带来的风险和责任。本项目开发者不对本项目所提供的服务和内容做出任何保证

感谢您的理解

## 📜 开源许可

- **本项目仅供个人学习研究使用，禁止用于商业及非法用途**
- 本项目基于 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可进行开源
  1. **修改和分发：** 任何对本项目的修改和分发都必须基于 AGPL-3.0 进行，源代码必须一并提供
  2. **派生作品：** 任何派生作品必须同样采用 AGPL-3.0，并在适当的地方注明原始项目的许可证
  3. **注明原作者：** 在任何修改、派生作品或其他分发中，必须在适当的位置明确注明原作者及其贡献
  4. **免责声明：** 根据 AGPL-3.0，本项目不提供任何明示或暗示的担保。请详细阅读 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 以了解完整的免责声明内容
  5. **社区参与：** 欢迎社区的参与和贡献，我们鼓励开发者一同改进和维护本项目
  6. **许可证链接：** 请阅读 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 了解更多详情

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=imsyy/SPlayer&type=Date)](https://star-history.com/#imsyy/SPlayer&Date)

---

> 以上内容为**原项目 SPlayer 的 README**，已保留原样。本 Fork（PocketTune）的说明请参见顶部「📌 项目说明」。
