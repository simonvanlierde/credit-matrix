import { expect, it } from "vitest";
import { lookupDoiWork } from "../doi-lookup";
import recorded from "./fixtures/crossref-credit.json";

it("reads deposited CRediT roles from Crossref's recorded schema 5.5 response", async () => {
  const result = await lookupDoiWork(recorded.message.DOI, async () => Response.json(recorded));
  expect(result).toMatchObject({
    ok: true,
    authors: [{ name: "Oliver de Place", roles: ["Project administration"] }],
  });
});

it("ignores Crossref contributor types and unknown roles without dropping the contributor", async () => {
  const result = await lookupDoiWork("10.5555/example", async () =>
    Response.json({
      message: {
        author: [
          {
            name: "The Research Team",
            role: [
              { vocabulary: "crossref", role: "software" },
              { vocabulary: "credit", role: "unknown" },
              { vocabulary: "credit", role: "conceptualisation" },
              { vocabulary: "credit", role: "conceptualization" },
            ],
          },
        ],
      },
    }),
  );
  expect(result).toMatchObject({ ok: true, authors: [{ roles: ["Conceptualization"] }] });
});
