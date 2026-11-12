import { createElement, useEffect, useState } from "react";
import { useLocale, useTranslations } from "@/lib/translations";

interface PagefindComponents {
  configureInstance(
    name: string,
    options: { bundlePath: string; metaCacheTag: string; lang: string },
  ): { setLanguage: (language: string) => void };
}

export function DocsSearch() {
  const t = useTranslations();
  const locale = useLocale();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    const path = "/pagefind/pagefind-component-ui.js";
    void import(/* @vite-ignore */ path)
      .then(() => {
        if (!active) return;
        const ui = (window as Window & { PagefindComponents?: PagefindComponents }).PagefindComponents;
        if (!ui) throw new Error("Search UI did not initialize");
        const build = document.querySelector<HTMLMetaElement>('meta[name="docs-search-build"]')?.content ?? "";
        ui.configureInstance("default", { bundlePath: "/pagefind/", metaCacheTag: build, lang: "en" }).setLanguage(
          locale,
        );
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    const workers = "serviceWorker" in navigator ? navigator.serviceWorker : null;
    const warmSearch = () => workers?.controller?.postMessage({ type: "cache-docs-search" });
    workers?.addEventListener("controllerchange", warmSearch);
    if (workers) {
      void workers.ready.then((registration) => {
        if (active) registration.active?.postMessage({ type: "cache-docs-search" });
      });
    }
    return () => {
      active = false;
      workers?.removeEventListener("controllerchange", warmSearch);
    };
  }, [locale]);
  return (
    <section aria-label={t("docsSearch")} className="docs-search">
      <link rel="stylesheet" href="/pagefind/pagefind-component-ui.css" />
      {status === "ready" ? (
        createElement(
          "pagefind-searchbox",
          {},
          <script type="text/pagefind-template">
            {`<a lang="en" class="pf-searchbox-result" id="{{ aria.result_id }}" href="{{ meta.url | default(url) | safeUrl }}" role="option" aria-selected="false">
  <p class="pf-searchbox-result-title" id="{{ aria.title_id }}">{{ meta.title | default("Untitled") }}</p>
  {{#if excerpt}}<p class="pf-searchbox-result-excerpt" id="{{ aria.excerpt_id }}">{{+ excerpt +}}</p>{{/if}}
</a>`}
          </script>,
        )
      ) : (
        <p role={status === "error" ? "alert" : "status"} className="text-sm text-on-surface-variant">
          {t(status === "error" ? "docsSearchFailed" : "docsSearchLoading")}
        </p>
      )}
    </section>
  );
}
