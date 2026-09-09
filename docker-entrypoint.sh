#!/bin/sh

set -e

# 启动 nginx（网页端静态资源 + /api 反代）
nginx

# 启动主进程（Fastify 后端，内置 UNM 解灰）
exec "$@"