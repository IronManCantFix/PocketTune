import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";
import AutoImport from "unplugin-auto-import/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
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
