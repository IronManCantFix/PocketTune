import { createRouter, createWebHashHistory, Router } from "vue-router";
import { openUserLogin } from "@/utils/modal";
import { isLogin } from "@/utils/auth";
import routes from "./routes";

// 基础配置
const router: Router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  // 保留滚动
  // scrollBehavior(to, _, savedPosition) {
  //   if (savedPosition) {
  //     return new Promise((resolve) => {
  //       setTimeout(() => {
  //         resolve(savedPosition);
  //       }, 300);
  //     });
  //   } else if (to.hash) {
  //     return {
  //       el: to.hash,
  //       behavior: "smooth",
  //     };
  //   } else {
  //     return { top: 0, left: 0, behavior: "smooth" };
  //   }
  // },
});

// 前置守卫
router.beforeEach((to, from, next) => {
  // 进度条
  if (to.path !== from.path) {
    window.$loadingBar?.start();
  }
  // 需要登录
  if (to.meta.needLogin && !isLogin()) {
    window.$loadingBar?.error();
    window.$message?.warning("请登录后使用");
    openUserLogin();
    return;
  }
  next();
});

// 后置守卫
router.afterEach((to, from) => {
  // 进度条
  window.$loadingBar?.finish();
  // 路由变化时重置滚动位置（排除仅 hash 变化的情况）
  if (to.fullPath.split("#")[0] !== from.fullPath.split("#")[0]) {
    requestAnimationFrame(() => {
      const mainContent = document.getElementById("main-content");
      if (mainContent) {
        const scrollContainer = mainContent.querySelector(".n-scrollbar-container");
        if (scrollContainer) scrollContainer.scrollTop = 0;
      }
    });
  }
});

export default router;
