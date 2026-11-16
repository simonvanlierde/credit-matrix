import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslations } from "@/lib/translations";

/**
 * Light/dark toggle for the header. The resolved theme is unknown during SSR, so both icons render
 * and the `.dark` class the head script sets picks one: the icon is there at first paint.
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
      <Sun className="hidden size-4 in-[.dark]:block" aria-hidden="true" />
      <Moon className="size-4 in-[.dark]:hidden" aria-hidden="true" />
    </button>
  );
}
