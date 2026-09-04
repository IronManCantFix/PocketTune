# 版本管理规则

本文档规定了 PocketTune 的版本号管理约定，请在开发与发版时严格遵守。

## 核心原则

> **版本号只在「发版」时更新。日常功能改动一律不改版本号。**

只有负责人明确说「发版」/「更新版本号」时，才允许推进版本号。改一个功能就一次 bump 是不允许的，会造成版本号失控和镜像混乱。

## 版本号位置（唯一来源）

- 版本号的**唯一来源**是 `package.json` 中的 `version` 字段。
- 设置页、关于页、鸣谢、日志等所有界面展示的版本号，均通过 `src/utils/version.ts`（`getFullVersion` / `getDisplayVersion`）或 `packageJson.version` **自动读取**，无需也不应单独写死。
- 因此发版时只需改 `package.json` 的 `version`，全部界面自动同步。

## 发版流程

发版通过 GitHub Actions 的 **Publish** 工作流（`.github/workflows/publish.yml`），**推送 `vX.Y.Z` 的 git tag 即自动触发构建**。步骤如下：

1. 确认当前 `package.json` 的 `version` 已改为目标版本（如 `4.2.0`），并已合并到 `main` 且推送。
2. 在 `main` 上打 tag `vX.Y.Z`（与 `package.json` 的 `version` 一致），并推送：
   ```bash
   git tag v4.2.0 && git push origin v4.2.0
   ```
3. 工作流监听到 `v*` tag 推送后自动触发，用 **tag 名**（去掉 `v` 前缀）作为发布版本，构建并推送 Docker 镜像到 ghcr.io（带 `X.Y.Z` 与 `latest` 两个标签）。

> 说明：tag 由负责人确认发版后主动打推；工作流不再需要手动在 Actions 页面触发，也不负责改写版本号。

## 规则清单

- **tag 驱动发布**：只有推送 `vX.Y.Z` 格式的 tag 才会触发构建；打 `v` 开头但不符合 `vX.Y.Z` 格式的 tag 会触发校验失败并中止，避免误发布。
- **版本号跟着 package.json 走**：界面版本号统一读取 `package.json`，改动只改这一处；发版时 `package.json` 的 `version` 必须与 tag 版本一致。
- **发版才改版本**：日常提交（功能、修复、重构）不修改 `package.json` 的 `version`，也不打 tag。
- **可追溯**：每个 tag `vX.Y.Z` 对应一次正式发布，与 ghcr.io 上的镜像 `X.Y.Z` 一一对应。
