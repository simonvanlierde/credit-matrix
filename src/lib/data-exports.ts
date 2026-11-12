import {
  type Author,
  toCrossrefContributors,
  toCsv,
  toJats4rXml,
  toJson,
  toLatexCredits,
  toMarkdown,
  toMyst,
  toQuarto,
  toRoCrateFragment,
  toTenzing,
} from "@/core";
import type { RoleTranslator, UiTranslator } from "@/core/i18n";
import { download } from "@/lib/utils";

export type DataFormat =
  | "xml"
  | "crossref"
  | "json"
  | "csv"
  | "tenzing"
  | "markdown"
  | "latex"
  | "quarto"
  | "myst"
  | "ro-crate";

/** Machine-readable export formats, each able to be copied or downloaded. */
export const DATA_FORMATS: Record<
  DataFormat,
  {
    label: string;
    filename: string;
    mime: string;
  }
> = {
  xml: {
    label: "XML (JATS4R)",
    filename: "credit-contributors.xml",
    mime: "application/xml",
  },
  crossref: {
    label: "XML (Crossref)",
    filename: "crossref-contributors.xml",
    mime: "application/xml",
  },
  json: {
    label: "JSON",
    filename: "credit_result.json",
    mime: "application/json",
  },
  csv: { label: "CSV", filename: "credit_result.csv", mime: "text/csv;charset=utf-8" },
  tenzing: {
    label: "tenzing CSV",
    filename: "tenzing-contributors.csv",
    mime: "text/csv;charset=utf-8",
  },
  latex: {
    label: "LaTeX (latex-credits)",
    filename: "credit-contributors.tex",
    mime: "application/x-tex;charset=utf-8",
  },
  markdown: {
    label: "Markdown",
    filename: "credit-contributors.md",
    mime: "text/markdown;charset=utf-8",
  },
  quarto: { label: "Quarto YAML", filename: "credit-quarto.yml", mime: "application/yaml;charset=utf-8" },
  myst: { label: "MyST YAML", filename: "credit-myst.yml", mime: "application/yaml;charset=utf-8" },
  "ro-crate": {
    label: "RO-Crate",
    filename: "credit-ro-crate-fragment.json",
    mime: "application/ld+json",
  },
};

export type DataExportOptions = NonNullable<Parameters<typeof toJson>[1]> & {
  yesNo?: boolean;
  translateRole?: RoleTranslator;
  translateUi?: UiTranslator;
  outputLanguage?: string;
};

export function serializeDataExport(
  authors: Author[],
  dataFormat: DataFormat,
  {
    asks,
    includeAnswers,
    selfId,
    toolchain,
    yesNo,
    translateRole,
    translateUi,
    outputLanguage,
  }: DataExportOptions = {},
): string {
  switch (dataFormat) {
    case "json":
      return toJson(authors, { asks, includeAnswers, selfId, toolchain });
    case "xml":
      return toJats4rXml(authors, { yesNo });
    case "latex":
      return toLatexCredits(authors, { yesNo });
    case "quarto":
      return toQuarto(authors, { yesNo });
    case "myst":
      return toMyst(authors);
    case "crossref":
      return toCrossrefContributors(authors);
    case "csv":
      return toCsv(authors);
    case "tenzing":
      return toTenzing(authors);
    case "ro-crate":
      return JSON.stringify(toRoCrateFragment(authors).metadata, null, 2);
    case "markdown":
      return toMarkdown(authors, translateRole, translateUi, outputLanguage);
  }
}

export function downloadDataExport(format: DataFormat, text: string) {
  const { filename, mime } = DATA_FORMATS[format];
  // A BOM makes Excel read the file as UTF-8, so non-ASCII names survive.
  const bom = format === "csv" || format === "tenzing" ? "\uFEFF" : "";
  download(new Blob([bom, text], { type: mime }), filename);
}
