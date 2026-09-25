export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },
  runtimeConfig: {
    public: { proxyUrl: process.env.NUXT_PUBLIC_PROXY_URL || "" },
  },
  modules: ["@nuxtjs/tailwindcss", "shadcn-nuxt"],
  css: ["~/assets/css/tailwind.css"],
  app: {
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
    componentDir: "./components/ui",
  },
  tailwindcss: {
    cssPath: "~/assets/css/tailwind.css",
    configPath: "tailwind.config.js",
  },
  compatibilityDate: "2025-01-01",
});
