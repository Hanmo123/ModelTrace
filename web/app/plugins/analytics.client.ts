import { defineNuxtPlugin, useGtag, useRuntimeConfig } from "#imports";

export default defineNuxtPlugin((nuxtApp) => {
  if (import.meta.dev) return;
  const options = useRuntimeConfig().public.gtag;
  const { hostname, origin, pathname } = window.location;
  // Production artifacts are also used by local previews and browser tests.
  if (
    !options?.enabled ||
    !options.id ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname === "::1"
  )
    return;

  let referrer = "";
  try {
    referrer = new URL(document.referrer).origin;
  } catch {
    /* No referrer. */
  }
  const page = {
    page_title: "ModelTrace",
    page_location: origin + pathname,
    // Do not forward query strings, fragments, or referrer paths.
    page_referrer: referrer,
  };
  const { gtag, initialize } = useGtag();
  nuxtApp.hook("app:mounted", () => {
    nuxtApp.runWithContext(() => {
      // No provider state, API keys, prompts or model responses enter dataLayer.
      gtag("set", page);
      initialize();
      gtag("event", "page_view", page);
    });
  });
});
