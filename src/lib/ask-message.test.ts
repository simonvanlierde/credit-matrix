import { beforeEach, expect, it, vi } from "vitest";
import { createAuthor, decodeShareHash } from "@/core";
import { useContributionStore } from "@/store/contribution-store";
import { copyAskMessage } from "./ask-message";

vi.mock("./announce", () => ({ announce: vi.fn() }));

const initial = useContributionStore.getState();
const t = ((key: string, values?: { link?: string }) => values?.link ?? key) as never;

let copied = "";
beforeEach(() => {
  useContributionStore.setState(initial, true);
  copied = "";
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: (text: string) => {
        copied = text;
        return Promise.resolve();
      },
    },
    configurable: true,
  });
});

it.each([
  ["toggle", true],
  ["levels", false],
] as const)("an ask link from a %s draft says yes/no is %s", async (mode, yesNo) => {
  const bob = createAuthor("Bob White");
  useContributionStore.setState({ authors: [createAuthor("Jane Smith"), bob], inputMode: mode });
  expect(await copyAskMessage(bob, t)).toBe(true);
  const shared = await decodeShareHash(copied.slice(copied.indexOf("#")));
  expect(shared?.yesNo).toBe(yesNo);
});
