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
          { placeholder: t("docsSearchPlaceholder") },
          <script type="text/pagefind-template">
            {`<a lang="en" class="pf-searchbox-result" id="{{ aria.result_id }}" href="{{ meta.url | default(url) | safeUrl }}" role="option" aria-selected="false">
  <p class="pf-searchbox-result-title" id="{{ aria.title_id }}">{{ meta.title | default("Untitled") }}</p>
  {{#if excerpt}}<p class="pf-searchbox-result-excerpt" id="{{ aria.excerpt_id }}">{{+ excerpt +}}</p>{{/if}}
</a>`}
          </script>,
        )
      ) : status === "error" ? (
        <p role="alert" className="text-sm text-on-surface-variant">
          {t("docsSearchFailed")}
        </p>
      ) : (
        // Pagefind's own classes draw the box it will become, so the prerendered page and every
        // docs page load show the search box at first paint rather than text that swaps out.
        <div className="pf-searchbox">
          <div className="pf-searchbox-input-wrapper">
            <input
              className="pf-searchbox-input"
              type="text"
              disabled
              aria-label={t("docsSearch")}
              aria-describedby="docs-search-loading"
              placeholder={t("docsSearchPlaceholder")}
            />
            {/* Pagefind shows ⌘ K on a Mac; that one key changes when it loads. */}
            <span className="pf-trigger-shortcut" aria-hidden="true">
              <span className="pf-trigger-key">Ctrl</span>
              <span className="pf-trigger-key">K</span>
            </span>
          </div>
          <p id="docs-search-loading" role="status" className="sr-only">
            {t("docsSearchLoading")}
          </p>
        </div>
      )}
    </section>
  );
}
