export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },
  devServer: { port: 4200 },
  runtimeConfig: {
    public: { proxyUrl: process.env.NUXT_PUBLIC_PROXY_URL || "" },
  },
  modules: ["@nuxtjs/tailwindcss", "shadcn-nuxt", "nuxt-gtag"],
  gtag: {
    enabled:
      process.env.NODE_ENV === "production" &&
      process.env.NUXT_PUBLIC_GTAG_ENABLED !== "false",
    id: process.env.NUXT_PUBLIC_GTAG_ID || "G-R374H35YTH",
    // The client plugin excludes local previews before loading Google's script.
    initMode: "manual",
    config: {
      // Send one sanitized page_view from the client plugin, without duplicates.
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    },
  },
  css: ["~/assets/css/tailwind.css"],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      htmlAttrs: { lang: "zh-CN" },
      title: "ModelTrace",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content: "在浏览器本地运行的语言模型指纹归因工具",
        },
      ],
    },
  },
  shadcn: {
    prefix: "",
    componentDir: "@/components/ui",
  },
  tailwindcss: {
    cssPath: "~/assets/css/tailwind.css",
    configPath: "tailwind.config.js",
  },
  compatibilityDate: "2025-01-01",
});
