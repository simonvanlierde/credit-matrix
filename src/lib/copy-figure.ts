const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Copy a PNG with its alt text. A PNG on the clipboard carries no alt text, so the
 * same item also holds an `<img alt>` as HTML, which Word keeps on paste. The size
 * attributes are CSS pixels at 96 per inch, so the pasted figure keeps its print size.
 * Where the HTML flavour is refused (Firefox), the PNG alone is written.
 * Both flavours are promises so Safari keeps the user gesture while the PNG renders.
 */
export async function copyFigure(png: Promise<Blob>, alt: string, widthPx: number, heightPx: number, dpi: number) {
  const scale = 96 / dpi;
  const html = async () => {
    const img = `<img src="${await toDataUrl(await png)}" alt="${escapeAttr(alt)}" width="${Math.round(widthPx * scale)}" height="${Math.round(heightPx * scale)}">`;
    return new Blob([img], { type: "text/html" });
  };
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": html(), "image/png": png })]);
  } catch {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }
}
