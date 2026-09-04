# 构建阶段
FROM node:22-alpine AS builder

# 启用 corepack 并激活 packageManager 声明的 pnpm 版本
# （避免 npm install -g pnpm 拉取最新版 standalone 二进制的身份校验问题）
RUN corepack enable
ARG PNPM_VERSION=10.34.5
RUN corepack prepare pnpm@${PNPM_VERSION} --activate

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# 复制 workspace 定义与依赖清单（server 子包依赖需要一并解析）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json ./server/package.json

# 安装全量依赖并跳过安装脚本
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# 无 .env 时使用示例配置
RUN [ ! -e ".env" ] && cp .env.example .env || true

# 构建网页端产物
RUN npx vite build

# 单独收集 server 运行时生产依赖（deploy 提取 @pockettune/server 的最小生产闭包，含源码与 node_modules）
# --legacy 用于在未开启注入式 workspace 依赖时以传统方式部署
RUN pnpm deploy --filter=@pockettune/server --prod --legacy /runtime

# 运行阶段
FROM nginx:1.27-alpine-slim AS app

COPY --from=builder /app/dist /usr/share/nginx/html

COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint.sh

# 部署自包含的 server 运行时（源码 + 生产依赖）
COPY --from=builder /runtime /app

# 安装 Node 运行时
RUN apk add --no-cache nodejs \
    && sed -i 's/\r$//' /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

WORKDIR /app

ENV NODE_TLS_REJECT_UNAUTHORIZED=0

ENTRYPOINT ["/docker-entrypoint.sh"]

# 启动本地后端服务
CMD ["./node_modules/.bin/tsx", "index.ts"]
