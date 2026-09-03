# 构建阶段
FROM node:22-alpine AS builder

# 安装 pnpm
RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# 安装全量依赖并跳过安装脚本
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# 无 .env 时使用示例配置
RUN [ ! -e ".env" ] && cp .env.example .env || true

# 构建网页端产物
RUN npx vite build

# 单独收集 server 运行时生产依赖
RUN mkdir /runtime && cp package.json pnpm-lock.yaml /runtime/ && cd /runtime && pnpm install --prod --frozen-lockfile --ignore-scripts

# 运行阶段
FROM nginx:1.27-alpine-slim AS app

COPY --from=builder /app/dist /usr/share/nginx/html

COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint.sh

# 拷贝 server 运行时代码与生产依赖
COPY --from=builder /app/server /app/server
COPY --from=builder /runtime/node_modules /app/node_modules
COPY --from=builder /runtime/package.json /app/package.json

# 安装 Node 运行时
RUN apk add --no-cache nodejs npm \
    && sed -i 's/\r$//' /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

WORKDIR /app

ENV NODE_TLS_REJECT_UNAUTHORIZED=0

ENTRYPOINT ["/docker-entrypoint.sh"]

# 启动本地后端服务
CMD ["npx", "tsx", "server/index.ts"]
