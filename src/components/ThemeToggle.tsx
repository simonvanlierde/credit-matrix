import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslations } from "@/lib/translations";

/**
 * Light/dark toggle for the header. Renders nothing until mounted so server and
 * client agree on the icon (the resolved theme is unknown during SSR).
 */
export function ThemeToggle() {
  const t = useTranslations();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={mounted ? t(isDark ? "switchToLightTheme" : "switchToDarkTheme") : t("toggleTheme")}
      className="touch-target flex items-center justify-center size-9 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
    >
      {/* Placeholder size during SSR avoids layout shift on mount. */}
      {mounted && (isDark ? <Sun className="size-4" /> : <Moon className="size-4" />)}
    </button>
  );
}
