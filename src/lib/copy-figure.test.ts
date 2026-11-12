import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyFigure } from "./copy-figure";

async function readItem(item: ClipboardItem): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  for (const type of item.types) out[type] = await item.getType(type);
  return out;
}

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("copyFigure", () => {
  let write: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
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
    await copyFigure(Promise.resolve(PNG), 'Grace\'s "map" <b> & more', 600, 300, 300);

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

    await copyFigure(Promise.resolve(PNG), "alt", 100, 50, 96);

    expect(write).toHaveBeenCalledTimes(2);
    const [[item]] = write.mock.calls[1] as [ClipboardItem[]];
    expect((item as ClipboardItem).types).toEqual(["image/png"]);
  });
});
