import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createAuthor, toCsv, toJson, toQuarto, toTenzing } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { download } from "@/lib/utils";
import { messages as en } from "@/locales/en/messages";
import { OutputBlock } from "./OutputBlock";

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  download: vi.fn(),
}));

const authors = [createAuthor("Renée Example", { contributions: [{ role: "Software", score: 50 }] })];
const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

function jsonBlock(team = authors) {
  return (
    <IntlProvider locale="en" messages={en}>
      <OutputBlock authors={team} format="json" options={{ selfId: authors[0]?.id, toolchain: "typst" }} />
    </IntlProvider>
  );
}

it("previews, copies and downloads the same canonical JSON with its export options", async () => {
  render(jsonBlock());
  const expected = toJson(authors, { selfId: authors[0]?.id, toolchain: "typst" });
  expect((screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value).toBe(expected);
  fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
  fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
  expect(download).toHaveBeenCalledWith(expect.any(Blob), "credit_result.json");
  const blob = vi.mocked(download).mock.calls[0]?.[0];
  expect(blob?.type).toBe("application/json");
  expect(await readBlob(blob)).toBe(expected);
});

it("hides old copy feedback when the contributors change and keeps the output read-only", async () => {
  const view = render(jsonBlock());
  fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
  await screen.findByText("Copied");
  view.rerender(jsonBlock([createAuthor("Morgan Example")]));
  expect(screen.queryByText("Copied")).toBeNull();
  expect((screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).readOnly).toBe(true);
});

it("leaves text available for manual copying after clipboard failure", async () => {
  writeText.mockRejectedValue(new Error("clipboard unavailable"));
  render(jsonBlock());
  fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
  await screen.findByText("Copy failed");
  expect((screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value).toContain("Renée Example");
});

it("disables copy and download when there are no contributors", () => {
  render(jsonBlock([]));
  expect((screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value).toBe("");
  expect((screen.getByRole("button", { name: "Copy JSON" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Download JSON" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each([
  ["csv", "CSV", "credit_result.csv", toCsv],
  ["tenzing", "tenzing CSV", "tenzing-contributors.csv", toTenzing],
] as const)("keeps the %s download BOM out of copied text", async (format, label, filename, serialize) => {
  render(
    <IntlProvider locale="en" messages={en}>
      <OutputBlock authors={authors} format={format} />
    </IntlProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: `Copy ${label}` }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(serialize(authors)));
  fireEvent.click(screen.getByRole("button", { name: `Download ${label}` }));
  const blob = vi.mocked(download).mock.calls[0]?.[0];
  expect(await readBlob(blob)).toBe(`\uFEFF${serialize(authors)}`);
  expect(download).toHaveBeenCalledWith(expect.any(Blob), filename);
});

it("keeps JSON ask history optional while retaining the contributor identity and writing tool", () => {
  const id = authors[0]?.id;
  if (!id) throw new Error("expected a contributor");
  const options = { asks: { [id]: { sentAt: 1, prefilled: true } }, selfId: id, toolchain: "typst" as const };
  const block = (includeAnswers: boolean) => (
    <IntlProvider locale="en" messages={en}>
      <OutputBlock authors={authors} format="json" options={{ ...options, includeAnswers }} />
    </IntlProvider>
  );
  const view = render(block(true));
  const output = () => JSON.parse((screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value);
  expect(output().asks).toEqual(options.asks);
  view.rerender(block(false));
  expect(output().asks).toBeUndefined();
  expect(output()).toMatchObject({ selfId: id, toolchain: "typst" });
});

it("passes binary contribution mode through to the selected serializer", () => {
  render(
    <IntlProvider locale="en" messages={en}>
      <OutputBlock authors={authors} format="quarto" options={{ yesNo: true }} />
    </IntlProvider>,
  );
  expect((screen.getByRole("textbox", { name: "Quarto YAML" }) as HTMLTextAreaElement).value).toBe(
    toQuarto(authors, { yesNo: true }),
  );
});

function readBlob(blob: Blob | undefined): Promise<string> {
  if (!blob) throw new Error("expected a download");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      resolve(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
