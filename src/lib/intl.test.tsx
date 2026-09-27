import { describe, expect, it } from "vitest";
import { detectUiLocale } from "./intl";

describe("detectUiLocale", () => {
  it("takes the first browser language the interface speaks", () => {
    expect(detectUiLocale(["de-DE", "en-US"])).toBe("de");
    expect(detectUiLocale(["sv-SE", "nl-BE", "en"])).toBe("nl");
    expect(detectUiLocale(["ja"])).toBe("ja");
  });

  it("maps regional and script variants onto the catalog that serves them", () => {
    expect(detectUiLocale(["pt-BR"])).toBe("pt-PT");
    expect(detectUiLocale(["zh-CN"])).toBe("zh-Hans");
    expect(detectUiLocale(["zh-Hans-SG"])).toBe("zh-Hans");
  });

  it("does not hand a Traditional Chinese reader the Simplified catalog", () => {
    expect(detectUiLocale(["zh-TW", "fr"])).toBe("fr");
  });

  it("stays English when English comes first, nothing matches, or a tag is malformed", () => {
    expect(detectUiLocale(["en-GB", "de"])).toBe("en");
    expect(detectUiLocale(["sv", "fi"])).toBe("en");
    expect(detectUiLocale(["not a tag!", "it"])).toBe("it");
    expect(detectUiLocale([])).toBe("en");
  });
});
