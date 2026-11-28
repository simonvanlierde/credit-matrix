import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IntlProvider } from "@/lib/translations";
import type { ModelContext, ModelContextTool } from "@/lib/webmcp";
import { messages as en } from "@/locales/en/messages";
import { WebMcpRegistrar } from "./WebMcpRegistrar";

afterEach(() => {
  Reflect.deleteProperty(navigator, "modelContext");
});

it("registers tools on mount, unregisters on unmount, and re-registers cleanly", async () => {
  const tools = new Map<string, ModelContextTool>();
  const refused: string[] = [];
  const modelContext: ModelContext = {
    registerTool: (tool, { signal } = {}) => {
      if (signal?.aborted || tools.has(tool.name)) {
        refused.push(tool.name);
        return Promise.reject(new DOMException(`refused ${tool.name}`, "InvalidStateError"));
      }
      tools.set(tool.name, tool);
      signal?.addEventListener("abort", () => tools.delete(tool.name));
      return Promise.resolve();
    },
  };
  Object.defineProperty(navigator, "modelContext", { value: modelContext, configurable: true });

  const first = render(
    <IntlProvider locale="en" messages={en}>
      <WebMcpRegistrar />
    </IntlProvider>,
  );
  await waitFor(() => expect(tools.size).toBe(5));
  expect(refused).toEqual([]);

  first.unmount();
  expect(tools.size).toBe(0);

  const second = render(
    <IntlProvider locale="en" messages={en}>
      <WebMcpRegistrar />
    </IntlProvider>,
  );
  await waitFor(() => expect(tools.size).toBe(5));
  expect(refused).toEqual([]);
  second.unmount();
});
