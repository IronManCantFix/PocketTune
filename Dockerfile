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

# 安装 Node 运行时、ffmpeg 与简体中文字体（DLNA 封面视频流的字幕烧录必需）
# 字体用 Noto Sans CJK SC 单语言 OTF（16MB），替代 110MB 的全量 CJK 包
# 下载用 Node 内置 fetch（精简基础镜像无 ca-certificates，busybox wget 无法走 HTTPS）
RUN apk add --no-cache nodejs ffmpeg fontconfig \
    && node -e "const fs=require('fs');fs.mkdirSync('/usr/share/fonts',{recursive:true});const sources=['https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf','https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf','https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf'];(async()=>{for(const url of sources){try{const res=await fetch(url);if(!res.ok)throw new Error('HTTP '+res.status);const buf=Buffer.from(await res.arrayBuffer());if(buf.length<10485760)throw new Error('文件过小: '+buf.length);fs.writeFileSync('/usr/share/fonts/NotoSansCJKsc-Regular.otf',buf);console.log('字体下载成功 ('+Math.round(buf.length/1048576)+'MB): '+url);process.exit(0);}catch(e){console.warn('源失败: '+url+' -> '+e.message);}}console.error('所有字体源均失败');process.exit(1);})();" \
    && fc-cache -f \
    && sed -i 's/\r$//' /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

WORKDIR /app

ENTRYPOINT ["/docker-entrypoint.sh"]

# 启动本地后端服务
CMD ["./node_modules/.bin/tsx", "index.ts"]
