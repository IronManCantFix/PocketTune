# 版本管理规则

本文档规定了 PocketTune 的版本号管理约定，请在开发与发版时严格遵守。

## 核心原则

> **版本号只在「发版」时更新。日常功能改动一律不改版本号。**

只有负责人明确说「发版」/「更新版本号」时，才允许推进版本号。改一个功能就一次 bump 是不允许的，会造成版本号失控和镜像混乱。

## 版本号位置（唯一来源）

- 版本号的**唯一来源**是 `package.json` 中的 `version` 字段（当前：`4.0.0`）。
- 设置页、关于页、鸣谢、日志等所有界面展示的版本号，均通过 `src/utils/version.ts`（`getFullVersion` / `getDisplayVersion`）或 `packageJson.version` **自动读取**，无需也不应单独写死。
- 因此发版时只需改 `package.json` 的 `version`，全部界面自动同步。

## 发版流程

发版通过 GitHub Actions 的 **Publish** 工作流（`.github/workflows/publish.yml`），步骤如下：

1. 确认当前 `package.json` 的 `version` 已改为目标版本（如 `4.0.0`），并已合并到 `main`。
2. Actions 页 → **Publish** → **Run workflow**。
3. 在 **version** 输入框**手动填写本次发布的版本号**（不填写会触发"自动 patch+1"，仅在确认无人为指定时使用）。
4. 工作流会自动完成：写回版本 → 打 tag `vX.Y.Z` → 构建并推送 Docker 镜像到 ghcr.io（带 `X.Y.Z` 与 `latest` 两个标签）。

## 规则清单

- **不自动 bump**：除非明确要求，发版一律手动指定版本号，避免误触发多余的版本提交与 tag。
- **版本号跟着 package.json 走**：界面版本号统一读取 `package.json`，改动只改这一处。
- **发版才改版本**：日常提交（功能、修复、重构）不修改 `package.json` 的 `version`。
- **可追溯**：每个 tag `vX.Y.Z` 对应一次正式发布，与 ghcr.io 上的镜像 `X.Y.Z` 一一对应。
