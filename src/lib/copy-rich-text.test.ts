import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyRichText } from "./copy-rich-text";

/** Read a written ClipboardItem back as `{ [mime]: text }`. */
async function readItem(item: ClipboardItem): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const type of item.types) out[type] = await (await item.getType(type)).text();
  return out;
}

const HTML = "<p><strong>CRediT:</strong> <strong>Conceptualization</strong>: Grace Hopper</p>";
const TEXT = "CRediT: Conceptualization: Grace Hopper";

describe("copyRichText", () => {
  let write: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    write = vi.fn().mockResolvedValue(undefined);
    writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    // jsdom ships no ClipboardItem; the real one is a thin Blob container.
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(private readonly items: Record<string, Blob>) {}
        get types() {
          return Object.keys(this.items);
        }
        getType(type: string) {
          return Promise.resolve(this.items[type]);
        }
      },
    );
  });

  it("writes both the rich and the plain flavour in one item", async () => {
    await copyRichText(TEXT, HTML);

    expect(writeText).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0] as [ClipboardItem[]];
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) throw new Error("expected a clipboard item");
    expect(await readItem(item)).toEqual({ "text/html": HTML, "text/plain": TEXT });
  });

  it("falls back to plain text when the rich write is refused", async () => {
    // Safari refuses a write whose promise was not resolved in the gesture, and
    // Firefox refused `text/html` entirely until recently. Either way the copy
    // must still put the statement on the clipboard.
    write.mockRejectedValue(new DOMException("NotAllowedError"));

    await copyRichText(TEXT, HTML);

    expect(writeText).toHaveBeenCalledWith(TEXT);
  });

  it("falls back to plain text where ClipboardItem is missing", async () => {
    vi.stubGlobal("ClipboardItem", undefined);

    await copyRichText(TEXT, HTML);

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(TEXT);
  });

  it("falls back to plain text where the clipboard has no write()", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyRichText(TEXT, HTML);

    expect(writeText).toHaveBeenCalledWith(TEXT);
  });
});
