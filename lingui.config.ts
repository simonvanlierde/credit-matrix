import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  locales: ["en", "fr", "de", "es", "it", "pt-PT", "nl", "zh-Hans", "ja"],
  sourceLocale: "en",
  catalogs: [
    { path: "src/locales/{locale}/messages", include: ["src/components", "src/lib"] },
    { path: "src/core/credit-i18n/locales/{locale}/messages", include: ["src/core"] },
  ],
  format: formatter({ origins: false, explicitIdAsDefault: true }),
  compileNamespace: "es",
});
