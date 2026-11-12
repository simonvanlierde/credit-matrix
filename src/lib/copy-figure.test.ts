import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyFigure } from "./copy-figure";

async function readItem(item: ClipboardItem): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  for (const type of item.types) out[type] = await item.getType(type);
  return out;
}

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0";

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("copyFigure", () => {
  let write: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write }, userAgent: CHROME });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(private readonly items: Record<string, Blob | Promise<Blob>>) {}
        get types() {
          return Object.keys(this.items);
        }
        getType(type: string) {
          return Promise.resolve(this.items[type]);
        }
      },
    );
  });

  it("writes an img with alt, size and PNG data next to the PNG", async () => {
    expect(await copyFigure(Promise.resolve(PNG), 'Grace\'s "map" <b> & more', 600, 300, 300)).toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    const [[item]] = write.mock.calls[0] as [ClipboardItem[]];
    const { "text/html": html, "image/png": png } = await readItem(item as ClipboardItem);
    expect(png).toBe(PNG);
    expect(await html?.text()).toBe(
      '<img src="data:image/png;base64,iVBORw==" alt="Grace\'s &quot;map&quot; &lt;b&gt; &amp; more" width="192" height="96">',
    );
  });

  it("falls back to the PNG alone when the HTML flavour is refused", async () => {
    write.mockRejectedValueOnce(new DOMException("NotSupportedError"));

    expect(await copyFigure(Promise.resolve(PNG), "alt", 100, 50, 96)).toBe(false);

    expect(write).toHaveBeenCalledTimes(2);
    const [[item]] = write.mock.calls[1] as [ClipboardItem[]];
    expect((item as ClipboardItem).types).toEqual(["image/png"]);
  });

  it("writes both flavours in Firefox but reports that Word drops the alt text", async () => {
    vi.stubGlobal("navigator", { clipboard: { write }, userAgent: FIREFOX });

    expect(await copyFigure(Promise.resolve(PNG), "alt", 100, 50, 96)).toBe(false);

    expect(write).toHaveBeenCalledTimes(1);
    const [[item]] = write.mock.calls[0] as [ClipboardItem[]];
    expect((item as ClipboardItem).types).toEqual(["text/html", "image/png"]);
  });
});
