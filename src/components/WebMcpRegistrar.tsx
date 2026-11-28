import { useEffect, useRef } from "react";
import { useTranslations } from "@/lib/translations";

/**
 * Registers the workspace's WebMCP tools when `navigator.modelContext` is present,
 * lazy-loading the tool definitions so browsers without WebMCP pay nothing.
 * Renders nothing.
 */
export function WebMcpRegistrar() {
  const t = useTranslations();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    if (!navigator.modelContext?.registerTool) return;
    const off = new AbortController();
    import("@/lib/webmcp")
      .then(({ registerWebMcpTools }) => {
        if (!off.signal.aborted) {
          registerWebMcpTools({ signal: off.signal, t: (key, values) => tRef.current(key, values) });
        }
      })
      .catch(() => undefined);
    return () => off.abort();
  }, []);

  return null;
}
