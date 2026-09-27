import { describe, expect, it } from "vitest";
import { detect } from "./ImportModal";

describe("detect", () => {
  it("reads a comma list of names containing 'name' as names, not CSV", () => {
    expect(detect("Anne Namer, Bob Smith")).toBe("names");
  });

  it("reads text with a Name header cell as CSV", () => {
    expect(detect("Name,ORCID\nJane Smith,")).toBe("csv");
    expect(detect('"name" , Conceptualization\nJane Smith,100')).toBe("csv");
    expect(detect("﻿Name,Conceptualization\nJane Smith,100")).toBe("csv");
  });
});
