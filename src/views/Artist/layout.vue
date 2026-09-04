<template>
  <div
    ref="artistRef"
    :key="artistId"
    :class="['artist', { small: listScrolling }]"
    @scroll="pageScroll"
  >
    <!-- 歌手头部（详情+标签），移动端随列表滚动整体上滑 -->
    <div class="artist-header">
      <Transition name="fade" mode="out-in">
        <div v-if="artistDetailData" class="detail">
          <div v-if="!settingStore.hiddenCovers.artistDetail" class="cover">
            <n-image
              :src="artistDetailData.coverSize?.m || artistDetailData.cover"
              :previewed-img-props="{ style: { borderRadius: '8px' } }"
              :preview-src="artistDetailData.cover"
              :renderToolbar="renderToolbar"
              show-toolbar-tooltip
              class="cover-img"
              @load="coverLoaded"
            >
              <template #placeholder>
                <div class="cover-loading">
                  <img src="/images/artist.jpg?asset" class="loading-img" alt="loading-img" />
                </div>
              </template>
            </n-image>
            <!-- 封面背板 -->
            <n-image
              class="cover-shadow"
              preview-disabled
              :src="artistDetailData.coverSize?.m || artistDetailData.cover"
            />
          </div>
          <div class="data">
            <div class="name text-hidden">
              <n-text class="name-text">{{
                settingStore.hideBracketedContent
                  ? removeBrackets(artistDetailData.name)
                  : artistDetailData.name || "未知艺术家"
              }}</n-text>
              <n-text v-if="artistDetailData?.alia" class="name-alias" depth="3">
                {{ artistDetailData.alia || "未知艺术家" }}
              </n-text>
            </div>
            <n-collapse-transition :show="!listScrolling" class="collapse">
              <!-- 职业 -->
              <n-text v-if="artistDetailData?.identify" :depth="3" class="identify text-hidden">
                {{ artistDetailData.identify }}
              </n-text>
              <!-- 信息 -->
              <n-flex class="meta">
                <div
                  class="item"
                  @click="router.push({ name: 'artist-songs', query: { id: artistId } })"
                >
                  <SvgIcon name="Music" :depth="3" />
                  <n-text>{{ artistDetailData.musicSize || 0 }}</n-text>
                </div>
                <div
                  class="item"
                  @click="router.push({ name: 'artist-albums', query: { id: artistId } })"
                >
                  <SvgIcon name="Album" :depth="3" />
                  <n-text>{{ artistDetailData.albumSize || 0 }}</n-text>
                </div>
                <div
                  class="item"
                  @click="router.push({ name: 'artist-videos', query: { id: artistId } })"
                >
                  <SvgIcon name="Video" :depth="3" />
                  <n-text>{{ artistDetailData.mvSize || 0 }}</n-text>
                </div>
              </n-flex>
              <!-- 简介 -->
              <n-text
                v-if="artistDetailData.description"
                class="description text-hidden"
                @click="openDescModal(artistDetailData.description, '歌手简介')"
              >
                {{ artistDetailData.description }}
              </n-text>
            </n-collapse-transition>
            <n-flex class="menu" justify="space-between">
              <n-flex class="left" align="flex-end">
                <n-button
                  :focusable="false"
                  type="primary"
                  strong
                  secondary
                  round
                  @click="playAllSongs"
                >
                  <template #icon>
                    <SvgIcon name="Play" />
                  </template>
                  播放
                </n-button>
                <n-button
                  :focusable="false"
                  strong
                  secondary
                  round
                  @click="toLikeArtist(artistId, !isLikeArtist)"
                >
                  <template #icon>
                    <SvgIcon :name="isLikeArtist ? 'Favorite' : 'FavoriteBorder'" />
                  </template>
                  {{ isLikeArtist ? "取消关注" : "关注歌手" }}
                </n-button>
                <!-- 更多 -->
                <n-dropdown :options="moreOptions" trigger="click" placement="bottom-start">
                  <n-button :focusable="false" class="more" circle strong secondary>
                    <template #icon>
                      <SvgIcon name="List" />
                    </template>
                  </n-button>
                </n-dropdown>
              </n-flex>
            </n-flex>
          </div>
        </div>
        <div v-else class="detail">
          <n-skeleton v-if="!settingStore.hiddenCovers.artistDetail" class="cover" />
          <div class="data">
            <n-skeleton :repeat="4" text />
          </div>
        </div>
      </Transition>
      <!-- 标签页 -->
      <n-tabs v-model:value="artistType" class="tabs" type="segment" @update:value="tabChange">
        <n-tab name="artist-songs"> 单曲 </n-tab>
        <n-tab name="artist-albums"> 专辑 </n-tab>
        <n-tab name="artist-videos"> 视频 </n-tab>
      </n-tabs>
    </div>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component
            ref="componentRef"
            :is="Component"
            :id="artistId"
            class="router-view"
            :external-scroll-top="mobileScrollTop"
            :external-viewport-height="mobileViewportHeight"
            @scroll="listScroll"
          />
        </KeepAlive>
        <component
          v-else
          ref="componentRef"
          :is="Component"
          :id="artistId"
          class="router-view"
          :external-scroll-top="mobileScrollTop"
          :external-viewport-height="mobileViewportHeight"
          @scroll="listScroll"
        />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption } from "naive-ui";
import type { ArtistType } from "@/types/main";
import { coverLoaded, renderIcon, copyData, getShareUrl } from "@/utils/helper";
import { renderToolbar } from "@/utils/meta";
import { openDescModal, openBatchList } from "@/utils/modal";
import { artistDetail } from "@/api/artist";
import { formatArtistsList, removeBrackets } from "@/utils/format";
import { useDataStore, useSettingStore } from "@/stores";
import { toLikeArtist } from "@/utils/auth";
import ArtistSongs from "./songs.vue";

const route = useRoute();
const router = useRouter();
const dataStore = useDataStore();
const settingStore = useSettingStore();
// 根元素，移动端头部上滑联动用
const artistRef = ref<HTMLElement | null>(null);
// 与移动端样式的 @media (max-width: 768px) 保持一致
const isSmallScreen = useMediaQuery("(max-width: 768px)");

// 路由元素
const componentRef = ref<InstanceType<typeof ArtistSongs> | null>(null);

// 歌手 ID
const artistId = computed<number>(() => Number(route.query.id));

// 歌手分类
const artistType = ref<string>((route.name as string) || "artist-songs");

// 歌手数据
const artistDetailData = ref<ArtistType | null>(null);

// 列表是否滚动
const listScrolling = ref<boolean>(false);

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => [
  {
    label: "批量操作",
    key: "batch",
    show: artistType.value === "artist-songs",
    props: {
      onClick: () => {
        if (componentRef.value?.songData) {
          openBatchList(
            componentRef.value.songData,
            false,
            isLikeArtist.value ? artistId.value : undefined,
          );
        } else {
          window.$message.warning("暂无歌曲可操作");
        }
      },
    },
    icon: renderIcon("Batch"),
  },
  {
    label: "复制分享链接",
    key: "copy",
    props: {
      onClick: () => copyData(getShareUrl("artist", artistId.value), "已复制分享链接到剪贴板"),
    },
    icon: renderIcon("Share"),
  },
  {
    label: "打开源页面",
    key: "open",
    props: {
      onClick: () => {
        window.open(`https://music.163.com/#/artist?id=${artistId.value}`);
      },
    },
    icon: renderIcon("Link"),
  },
]);

// 是否处于收藏歌手
const isLikeArtist = computed(() => {
  return dataStore.userLikeData.artists.some((ar) => ar.id === artistId.value);
});

// 获取歌手详情
const getArtistDetail = async (id: number) => {
  try {
    if (!id) return;
    listScrolling.value = false;
    artistDetailData.value = null;
    const result = await artistDetail(id);
    artistDetailData.value = formatArtistsList(result.data.artist)[0];
    // 附加身份
    artistDetailData.value.identify = result.data.identify?.imageDesc;
  } catch (error) {
    console.error("Error getting artist detail:", error);
    window.$message.error("获取歌手详情失败");
  }
};

// Tabs 改变
const tabChange = (value: string) => {
  // 切换标签时回到顶部
  scrollToTop();
  router.push({
    name: value,
    query: { id: artistId.value },
  });
};

// 播放全部歌曲
const playAllSongs = async () => {
  await router.push({ name: "artist-songs", query: { id: artistId.value } });
  if (componentRef.value) componentRef.value.playAllSongs();
};

// 移动端整页滚动状态（驱动外滚模式虚拟列表）
const mobileScrollTop = ref(0);
const mobileViewportHeight = ref(0);

// 监听歌手页容器尺寸，同步外滚模式虚拟列表的视口高度
const { height: artistHeight } = useElementSize(artistRef);
watch(artistHeight, (h) => {
  if (h && isSmallScreen.value) mobileViewportHeight.value = h;
});

// 滚动到顶部（直接赋值滚动位置，避免 transition 打断平滑滚动）
const scrollToTop = () => {
  const root = artistRef.value;
  if (!root) return;
  root.scrollTop = 0;
  // 同步外滚模式虚拟列表滚动位置
  mobileScrollTop.value = 0;
};

// 列表滚动
const listScroll = (e: Event) => {
  if (isSmallScreen.value) {
    // 移动端：由整页滚动驱动（pageScroll），VirtualScroll 的滚动事件仅用于桌面端
    return;
  }
  // 桌面端：滚动高度
  const scrollTop = (e.target as HTMLElement).scrollTop;
  listScrolling.value = scrollTop > 10;
};

// 移动端：整页滚动（歌手头部随页面滚出，列表从头部下方开始）
const pageScroll = (e: Event) => {
  const root = artistRef.value;
  if (!root) return;
  const target = e.target as HTMLElement;
  // 外滚模式虚拟列表：滚动位置与视口高度
  mobileScrollTop.value = target.scrollTop;
  mobileViewportHeight.value = target.clientHeight;
};

// 监听路由更新
onBeforeRouteUpdate((to) => {
  listScrolling.value = false;
  // 检查是否仍在 artist 路由下
  const isArtistRoute = to.matched.some((m) => m.name === "artist");
  if (!isArtistRoute) return;
  artistType.value = to.name as string;
});

// 监听 ID 变化
watch(
  () => artistId.value,
  (val) => {
    if (val) {
      // 切换歌手时回到顶部，避免残留滚动位置
      scrollToTop();
      getArtistDetail(val);
    }
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
.artist {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  .detail {
    display: flex;
    height: 240px;
    width: 100%;
    padding: 12px 0 30px 0;
    will-change: height, opacity;
    z-index: 1;
    transition:
      height 0.3s,
      opacity 0.3s;
    .cover {
      position: relative;
      display: flex;
      width: auto;
      height: 100%;
      aspect-ratio: 1 / 1;
      margin-right: 20px;
      border-radius: 50%;
      transition:
        opacity 0.3s,
        margin 0.3s,
        transform 0.3s;
      :deep(img) {
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 0.35s ease-in-out;
      }
      .cover-img {
        border-radius: 50%;
        overflow: hidden;
        z-index: 1;
        transition:
          opacity 0.3s,
          filter 0.3s,
          transform 0.3s;
      }
      .cover-shadow {
        position: absolute;
        top: 8px;
        height: 100%;
        width: 100%;
        border-radius: 50%;
        filter: blur(12px) opacity(0.6);
        transform: scale(0.92, 0.96);
        z-index: 0;
        background-size: cover;
        aspect-ratio: 1/1;
        :deep(img) {
          opacity: 1;
        }
      }
      &:active {
        transform: scale(0.98);
      }
    }
    .data {
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1;
      padding-right: 60px;
      :deep(.n-skeleton) {
        height: 30px;
        margin-top: 12px;
        border-radius: 8px;
        &:first-child {
          width: 60%;
          margin-top: 0;
          height: 40px;
        }
      }
      .description {
        margin-bottom: 8px;
        padding-left: 4px;
        cursor: pointer;
      }
      .name {
        font-size: 30px;
        font-weight: bold;
        height: 48px;
        transition:
          font-size 0.3s var(--n-bezier),
          color 0.3s var(--n-bezier);
        .name-alias {
          &::before {
            content: "（";
            margin-right: 6px;
          }
          &::after {
            content: "）";
            margin-left: 6px;
          }
        }
      }
      .identify {
        font-size: 16px;
        margin-bottom: 8px;
        padding-left: 4px;
      }
      .collapse {
        position: absolute;
        top: 48px;
        margin: 8px 0;
      }
      .meta {
        margin-bottom: 8px;
        .item {
          display: flex;
          align-items: center;
          cursor: pointer;
          .n-icon {
            font-size: 20px;
            margin-right: 4px;
          }
        }
      }
      .menu {
        position: absolute;
        left: 0;
        bottom: 0;
        width: 100%;
        .n-button {
          height: 40px;
          transition: all 0.3s var(--n-bezier);
        }
        .more {
          width: 40px;
        }
      }
    }
  }
  .tabs {
    height: 40px;
    z-index: 1;
  }
  .router-view {
    flex: 1;
    overflow: hidden;
    &.artist-songs {
      position: absolute;
      width: 100%;
      height: 100%;
      padding-top: 280px;
      transition:
        padding 0.3s,
        transform 0.3s,
        opacity 0.3s;
    }
  }
  // 桌面端：滚动时收起歌手头部。移动端为纵向布局，无需收起，若应用这些规则会与移动端样式冲突导致布局错乱
  @media (min-width: 769px) {
    &.small {
      .detail {
        height: 120px;
        .cover {
          margin-right: 12px;
          .cover-mask,
          .play-count {
            opacity: 0;
          }
        }
        .data {
          .name {
            font-size: 22px;
          }
          .menu {
            .n-button,
            .search {
              height: 32px;
              --n-font-size: 13px;
              --n-padding: 0 14px;
              --n-icon-size: 16px;
            }
          }
        }
      }
      .router-view {
        &.artist-songs {
          padding-top: 160px;
        }
      }
    }
  }
}

// 移动端适配：歌手页纵向布局，整页滚动（头部随页面滚出，列表从头部下方开始）
@media (max-width: 768px) {
  .artist {
    // 歌手页自身作为滚动容器，头部与列表整体滚动
    // 用布局高度变量固定视口高度（--layout-height 为无单位数值，需乘 1px）
    // 双类提权，避免被基类 height:100% 覆盖
    height: calc(var(--layout-height) * 1px) !important;
    overflow-y: auto !important;
    .artist-header {
      // 头部文档流占位，随整页滚动自然滚出视口
      position: relative;
      background-color: rgba(var(--background));
      z-index: 1;
    }
    .detail {
      flex-direction: column;
      height: auto;
      padding: 12px 0 20px 0;
      .cover {
        width: 120px;
        height: 120px;
        margin: 0 auto 16px;
      }
      .data {
        padding-right: 0;
        .name {
          font-size: 22px;
          height: auto;
          text-align: center;
        }
        .identify {
          text-align: center;
        }
        .collapse {
          position: static;
          margin: 8px 0;
        }
        .meta {
          justify-content: center;
        }
        .menu {
          position: static;
          justify-content: center;
          margin-top: 12px;
        }
      }
    }
    .router-view {
      // 文档流，随整页滚动；高度由内容撑开
      flex: none;
      overflow: visible;
      &.artist-songs {
        position: static;
        padding-top: 0;
        overflow: visible;
      }
    }
  }
}
</style>
