#!/bin/sh

set -e

# 检测指定端口是否空闲
# host 网络模式下宿主 80/443 可能被 NAS 自身服务占用，此时无法劫持网易云域名
check_port_free() {
    node -e 'const net=require("net");const port=Number(process.argv[1]);const s=net.createServer();s.once("error",()=>process.exit(1));s.once("listening",()=>s.close(()=>process.exit(0)));s.listen(port,"0.0.0.0");' "$1"
}

# UNM 监听端口（可用环境变量覆盖，默认与原行为一致）
UNM_HTTP_PORT="${UNM_PORT:-80}"
UNM_HTTPS_PORT="${UNM_SSL_PORT:-443}"

if check_port_free "$UNM_HTTP_PORT" && check_port_free "$UNM_HTTPS_PORT"; then
    # 端口空闲：启动解锁服务
    ./node_modules/.bin/unblockneteasemusic -p ${UNM_HTTP_PORT}:${UNM_HTTPS_PORT} -s -f ${NETEASE_SERVER_IP:-220.197.30.65} -o ${UNBLOCK_SOURCES:-kugou bodian pyncmd} 2>&1 &

    # point the neteasemusic address to the unblock service
    if ! grep -q "music.163.com" /etc/hosts; then
        echo "127.0.0.1 music.163.com" >> /etc/hosts
    fi
    if ! grep -q "interface.music.163.com" /etc/hosts; then
        echo "127.0.0.1 interface.music.163.com" >> /etc/hosts
    fi
    if ! grep -q "interface3.music.163.com" /etc/hosts; then
        echo "127.0.0.1 interface3.music.163.com" >> /etc/hosts
    fi
    if ! grep -q "interface.music.163.com.163jiasu.com" /etc/hosts; then
        echo "127.0.0.1 interface.music.163.com.163jiasu.com" >> /etc/hosts
    fi
    if ! grep -q "interface3.music.163.com.163jiasu.com" /etc/hosts; then
        echo "127.0.0.1 interface3.music.163.com.163jiasu.com" >> /etc/hosts
    fi
    echo "[entrypoint] UNM 解锁服务已启动（端口 ${UNM_HTTP_PORT}/${UNM_HTTPS_PORT}，域名劫持生效）"
else
    # 端口被占用：跳过 UNM 服务与 hosts 劫持，API 直连官方服务器
    # 解灰由应用内置的 UNM 库在 song_url 响应后处理中完成，不影响播放
    echo "[entrypoint] 端口 ${UNM_HTTP_PORT}/${UNM_HTTPS_PORT} 已被占用（host 网络模式常见），跳过 UNM 服务与域名劫持"
    echo "[entrypoint] 网易云 API 将直连官方服务器，解灰由应用内置 UNM 库处理"
fi

# start the nginx daemon
nginx

# start the main process
exec "$@"