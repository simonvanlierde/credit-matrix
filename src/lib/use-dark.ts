import { useTheme } from "next-themes";

/** Whether the page is drawn in the dark theme, after resolving "system". */
export function useDark(): boolean {
  return useTheme().resolvedTheme === "dark";
}
