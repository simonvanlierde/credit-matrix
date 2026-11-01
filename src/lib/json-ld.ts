import codemeta from "../../codemeta.json";

/** The release's authors as schema.org people; search engines read the person by `name`. */
export const authors = codemeta.author.map(({ "@id": id, givenName, familyName }) => ({
  "@type": "Person",
  "@id": id,
  name: `${givenName} ${familyName}`,
  givenName,
  familyName,
}));
