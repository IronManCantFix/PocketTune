> 发帖前请：
>
> 1. 将文末截图占位替换为你自己的实机截图（手机端 + NAS 面板各来一张效果最好）
> 2. 补全「项目地址」处你发布该帖所用的论坛账号名（可选）
> 3. 按目标论坛的版规微调措辞（技术社区可精简，NAS 社区可保留部署细节）

---

# PocketTune — 把网易云音乐装进 NAS：纯 Web 网易云音乐客户端，移动端丝滑适配，Docker 一键部署

## 这是个什么东西？

先说结论：**一个可以部署在你自己 NAS 上的纯 Web 网易云音乐客户端**，浏览器打开就能用，手机、平板、电脑全端适配，无需安装任何客户端。

项目地址：**https://github.com/IronManCantFix/PocketTune**（开源，AGPL-3.0）

它是 SPlayer（原作者 imsyy，现为 SPlayer-Dev 团队维护）的二开项目。原项目已经做得非常出色了，我的改动方向非常明确：

> 把它改造成 **「纯 Web、移动端优先、面向 NAS 部署」** 的形态。

## 为什么要做这个？

作为一个 NAS 玩家 + 网易云重度用户，我长期面临三个痛点：

1. **手机端网易云越来越臃肿**——广告、直播、商城、社交……我只想要一个干净的听歌界面
2. **桌面客户端太重**——我只是想在 NAS 的 Web 生态里多一个"音乐服务"，像 Jell­yin / Navidrome 那样常驻可用
3. **移动端体验差的 Web 音乐客户端一抓一大把**——大部分 Web 播放器在手机浏览器里根本没有适配，按钮挤成一团、歌词溢出、播放页划不动

于是我基于 SPlayer 做了深度改造：**砍掉桌面端，全力打磨移动端，做成 Docker 镜像随开随用**。现在它是我家飞牛 App 里使用频率最高的一个 Web 应用，随手一开就能听歌，体验非常舒服。

## ✨ 主要特点

### 📱 移动端深度适配（本项目的核心卖点）

这不是"能看"级别的适配，而是逐页面打磨过的：

- 统一响应式断点系统，首页 / 发现 / 歌单 / 评论 / 云盘 / 歌手页全部重新适配
- 搜索栏聚焦全屏遮罩、点击外部自动恢复，不再误触
- 歌手详情页滚动重构：头部固定、详情随列表上滑滑出、列表铺满全高滚动，手指划起来是"原生感"
- 全屏播放器禁止左右滑动误拖动，仅通过指示器切换
- iOS 底部安全区 / 刘海屏顶部避让全部处理，没有白线、没有遮挡

### 🎵 网易云能力完整保留

- 扫码 / 手机号登录
- 逐字歌词（AMLL 方案）、歌词翻译、封面主题色自适应
- MV 播放、音乐频谱、评论、每日推荐、私人 FM
- **云盘音乐**：播放、纠正、**批量删除**、**本地歌曲上传**（v4.1 新增）
- Last.fm Scrobble 播放记录上报

### 🖥️ NAS 玩家狂喜

- **Docker 一键部署**，镜像支持 `amd64` / `arm64` 双架构，x86 与 ARM NAS 都能跑
- 镜像由 GitHub Actions 云端构建发布到 ghcr.io，拉取即用
- **内置 Subsonic / Navidrome 客户端支持**——如果你 NAS 上有 Navidrome，这个应用可以直接当它的前端，多服务器管理、自动连接
- **内置 UnblockNeteaseMusic**，灰色歌曲自动替换可用音源（酷狗 / 酷我 / B站）

### 🔒 数据全部存在浏览器，服务端零存储

这一点对多人共用 NAS 的家庭场景特别友好：

- **所有数据只存放在你自己的浏览器里**（本地存储 / IndexedDB）——账号登录态、歌单、播放记录、设置、主题偏好等，全部不落服务端
- **NAS 服务器只做一个"转发 + 网页托管"的角色**，不保存任何用户的个人信息
- **不同浏览器 / 不同设备可以各自登录不同的网易云账号**：电脑 Chrome 登录你的号，iPad Safari 登录家人的号，同一个地址互不干扰；清除浏览器数据即退出登录，数据跟人走，不跟服务器走
- 副作用是换浏览器或清缓存后需要重新登录——但这正是"数据归你自己管"的另一面

### 🧹 纯净

- 无 Electron、无桌面端残留代码
- 无首次协议弹窗，打开即用
- 前端 + 后端 + 音源替换服务打包在一个镜像里，nginx 反代，部署零配置

## 🐳 部署

一条命令：

```bash
docker run -d \
  --name PocketTune \
  -p 25884:25884 \
  --restart always \
  ghcr.io/ironmancantfix/pockettune:latest
```

或者 docker compose：

```yaml
services:
  PocketTune:
    image: ghcr.io/ironmancantfix/pockettune:latest
    container_name: PocketTune
    ports:
      - 25884:25884
    restart: always
    environment:
      # 所有变量均非必填
      - NETEASE_SERVER_IP=220.197.30.65 # ping music.163.com 获取
      - UNBLOCK_SOURCES=kugou kuwo bilibili
      - ENABLE_FLAC=false
      - SELECT_MAX_BR=true
      - LOG_LEVEL=info
```

飞牛 / 群晖 / 1Panel 等面板用户：直接在面板里从镜像 `ghcr.io/ironmancantfix/pockettune:latest` 创建容器，映射端口 `25884` 即可。**记得手动填一个容器名**（部分面板会拿镜像路径第一段当默认名，比如 `pockettune`，不影响使用但看着别扭）。

更多环境变量、升级方法见项目 README。

## 🖼️ 效果图

<!-- 在这里插入你的实机截图 -->

## 🚀 后续计划

- **PWA 支持**：加入 Service Worker 与 Web App Manifest，手机浏览器"添加到主屏幕"后即可像原生 App 一样全屏运行、离线缓存，体验再上一档（目前正在规划中，欢迎在 Issue 里催更）
- 更多想法正在路上，也欢迎大家在评论区 / Issue 里提需求，好用的点子我会优先安排

## 🙏 鸣谢与声明

- 本项目基于 [SPlayer-Dev/SPlayer](https://github.com/SPlayer-Dev/SPlayer)（原作者 [imsyy](https://github.com/imsyy)）二开，感谢原作者与所有贡献者
- 音源替换能力来自 [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server)
- 本项目部分功能使用了网易云音乐的第三方 API 服务，**仅供个人学习研究使用，禁止用于商业及非法用途**，请支持正版音乐
- 采用 AGPL-3.0 开源，觉得好用欢迎去仓库点个 Star ⭐，有问题也欢迎提 Issue
