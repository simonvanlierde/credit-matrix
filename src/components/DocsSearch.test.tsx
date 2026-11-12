import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntlProvider } from "@/lib/translations";
import { messages } from "@/locales/en/messages";
import { DocsSearch } from "./DocsSearch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("warms the replacement worker after an existing worker was ready, until unmounted", async () => {
  const previous = { postMessage: vi.fn() };
  const replacement = { postMessage: vi.fn() };
  const workers = Object.assign(new EventTarget(), {
    ready: Promise.resolve({ active: previous }),
    controller: previous,
  });
  vi.stubGlobal("navigator", { serviceWorker: workers });
  const view = render(
    <IntlProvider locale="en" messages={messages}>
      <DocsSearch />
    </IntlProvider>,
  );
  await waitFor(() => expect(previous.postMessage).toHaveBeenCalledWith({ type: "cache-docs-search" }));
  workers.controller = replacement;
  workers.dispatchEvent(new Event("controllerchange"));
  expect(replacement.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "cache-docs-search" });
  view.unmount();
  workers.dispatchEvent(new Event("controllerchange"));
  expect(replacement.postMessage).toHaveBeenCalledTimes(1);
});
