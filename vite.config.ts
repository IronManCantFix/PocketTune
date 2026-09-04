import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";
import AutoImport from "unplugin-auto-import/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import { VitePWA } from "vite-plugin-pwa";
import viteCompression from "vite-plugin-compression";
import wasm from "vite-plugin-wasm";

// 网页端构建配置
export default defineConfig(({ mode }) => {
  // 读取环境变量
  const env = loadEnv(mode, process.cwd());
  // 前端开发服务器端口
  const webPort: number = Number(env.VITE_WEB_PORT || 14558);
  // 本地后端端口
  const apiPort: number = Number(env.VITE_DEV_API_PORT || 3000);
  return {
    plugins: [
      vue(),
      AutoImport({
        imports: [
          "vue",
          "vue-router",
          "@vueuse/core",
          {
            "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"],
          },
        ],
        eslintrc: {
          enabled: true,
          filepath: "./auto-eslint.mjs",
        },
      }),
      Components({
        resolvers: [NaiveUiResolver()],
      }),
      viteCompression(),
      wasm(),
      // PWA 支持：可安装 + 基础离线壳
      VitePWA({
        // 自动更新：新版本构建后用户下次打开即为新版
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "icons/favicon-192x192.png", "icons/favicon-512x512.png"],
        manifest: {
          name: "PocketTune",
          short_name: "PocketTune",
          description: "极简在线音乐播放器",
          theme_color: "#000000",
          background_color: "#000000",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "/icons/favicon-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/icons/favicon-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              // maskable 图标：Android 自适应图标，四周需留安全边距
              src: "/icons/favicon-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // 预缓存应用壳：js/css/html 及字体、图标、wasm 等静态资源
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,wasm,jpg,jpeg,webp}"],
          // 排除压缩产物，避免重复缓存
          globIgnores: ["**/*.gz", "**/*.map"],
          // 最大文件为 ffmpeg.wasm(约 3.1MB)，需调大默认 2MB 上限
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/"),
        "@shared": resolve(__dirname, "src/types/shared"),
        // OpenCC 中文转换依赖 WASM 产物，保留
        "@opencc": resolve(__dirname, "native/ferrous-opencc-wasm/pkg"),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/style/breakpoints.scss" as *;\n`,
          silenceDeprecations: ["legacy-js-api"],
        },
      },
    },
    server: {
      port: webPort,
      // 本地后端代理，不重写路径
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: webPort,
    },
    build: {
      outDir: "dist",
      minify: "terser",
      terserOptions: {
        compress: {
          pure_funcs: ["console.log"],
        },
      },
      sourcemap: false,
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
        output: {
          manualChunks: {
            stores: ["src/stores/data.ts", "src/stores/index.ts"],
          },
        },
      },
    },
  };
});
