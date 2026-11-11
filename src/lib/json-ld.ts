import codemeta from "../../codemeta.json";
import packageJson from "../../package.json";

/** The home page's meta, Open Graph and structured-data description. */
export const homeDescription =
  "Draft your paper's CRediT statement. Co-authors fill in their own roles by link; export the statement and a heatmap. Open source, runs in your browser.";

/** The release's authors as schema.org people. They join the owner's node on simonvanlierde.com; the ORCID iD stays as `sameAs`. */
export const authors = codemeta.author.map(({ "@id": orcid, givenName, familyName }) => ({
  "@type": "Person",
  "@id": "https://simonvanlierde.com/#person",
  name: `${givenName} ${familyName}`,
  givenName,
  familyName,
  sameAs: orcid,
}));

// Built from codemeta.json (which citesync keeps in step with CITATION.cff) and package.json, so the
// licence, version and authors never drift from the release. Search engines read only schema.org
// terms, so the CodeMeta record is mapped, not embedded.
export const webApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: codemeta.name,
  description: homeDescription,
  url: codemeta.url,
  applicationCategory: "ReferenceApplication",
  operatingSystem: codemeta.operatingSystem,
  isAccessibleForFree: true,
  license: codemeta.license,
  softwareVersion: packageJson.version,
  identifier: codemeta.identifier,
  keywords: codemeta.keywords.join(", "),
  sameAs: codemeta.codeRepository,
  author: authors,
};
