/**
 * The 14 CRediT (Contributor Roles Taxonomy) roles as defined by NISO.
 * https://credit.niso.org/
 *
 * Stored as a const tuple so the role names are narrowed to their literal
 * string types, so callers can use `CreditRoleName` as a union type.
 *
 * Each role carries its canonical NISO `id` (the official role UUID) so the
 * identifiers travel with exported data. Crossref adds CRediT to its metadata
 * schema in 2026 and these UUIDs are the machine-readable role keys.
 */

export const CREDIT_ROLES = [
  {
    name: "Conceptualization",
    id: "8b73531f-db56-4914-9502-4cc4d4d8ed73",
    description: "Ideas; formulation or evolution of overarching research goals and aims.",
    url: "https://credit.niso.org/contributor-roles/conceptualization/",
  },
  {
    name: "Data curation",
    id: "f93e0f44-f2a4-4ea1-824a-4e0853b05c9d",
    description:
      "Management activities to annotate (produce metadata), scrub data and maintain research data (including software code, where it is necessary for interpreting the data itself) for initial use and later re-use.",
    url: "https://credit.niso.org/contributor-roles/data-curation/",
  },
  {
    name: "Formal analysis",
    id: "95394cbd-4dc8-4735-b589-7e5f9e622b3f",
    description:
      "Application of statistical, mathematical, computational, or other formal techniques to analyze or synthesize study data.",
    url: "https://credit.niso.org/contributor-roles/formal-analysis/",
  },
  {
    name: "Funding acquisition",
    id: "34ff6d68-132f-4438-a1f4-fba61ccf364a",
    description: "Acquisition of the financial support for the project leading to this publication.",
    url: "https://credit.niso.org/contributor-roles/funding-acquisition/",
  },
  {
    name: "Investigation",
    id: "2451924d-425e-4778-9f4c-36c848ca70c2",
    description:
      "Conducting a research and investigation process, specifically performing the experiments, or data/evidence collection.",
    url: "https://credit.niso.org/contributor-roles/investigation/",
  },
  {
    name: "Methodology",
    id: "f21e2be9-4e38-4ab7-8691-d6f72d5d5843",
    description: "Development or design of methodology; creation of models.",
    url: "https://credit.niso.org/contributor-roles/methodology/",
  },
  {
    name: "Project administration",
    id: "a693fe76-ea33-49ad-9dcc-5e4f3ac5f938",
    description: "Management and coordination responsibility for the research activity planning and execution.",
    url: "https://credit.niso.org/contributor-roles/project-administration/",
  },
  {
    name: "Resources",
    id: "ebd781f0-bf79-492c-ac21-b31b9c3c990c",
    description:
      "Provision of study materials, reagents, materials, patients, laboratory samples, animals, instrumentation, computing resources, or other analysis tools.",
    url: "https://credit.niso.org/contributor-roles/resources/",
  },
  {
    name: "Software",
    id: "f89c5233-01b0-4778-93e9-cc7d107aa2c8",
    description:
      "Programming, software development; designing computer programs; implementation of the computer code and supporting algorithms; testing of existing code components.",
    url: "https://credit.niso.org/contributor-roles/software/",
  },
  {
    name: "Supervision",
    id: "0c8ca7d4-06ad-4527-9cea-a8801fcb8746",
    description:
      "Oversight and leadership responsibility for the research activity planning and execution, including mentorship external to the core team.",
    url: "https://credit.niso.org/contributor-roles/supervision/",
  },
  {
    name: "Validation",
    id: "4b1bf348-faf2-4fc4-bd66-4cd3a84b9d44",
    description:
      "Verification, whether as a part of the activity or separate, of the overall replication/reproducibility of results/experiments and other research outputs.",
    url: "https://credit.niso.org/contributor-roles/validation/",
  },
  {
    name: "Visualization",
    id: "76b9d56a-e430-4e0a-84c9-59c11be343ae",
    description:
      "Preparation, creation and/or presentation of the published work, specifically visualization/data presentation.",
    url: "https://credit.niso.org/contributor-roles/visualization/",
  },
  {
    name: "Writing \u2013 original draft",
    id: "43ebbd94-98b4-42f1-866b-c930cef228ca",
    description:
      "Preparation, creation and/or presentation of the published work, specifically writing the initial draft (including substantive translation).",
    url: "https://credit.niso.org/contributor-roles/writing-original-draft/",
  },
  {
    name: "Writing \u2013 review & editing",
    id: "d3aead86-f2a2-47f7-bb99-79de6421164d",
    description:
      "Preparation, creation and/or presentation of the published work by those from the original research group, specifically critical review, commentary or revision \u2013 including pre- or post-publication stages.",
    url: "https://credit.niso.org/contributor-roles/writing-review-editing/",
  },
] as const;

export type CreditRoleName = (typeof CREDIT_ROLES)[number]["name"];

/** Lookup a role by name. Throws if the name is not a valid CRediT role. */
export function getRoleByName(name: string): (typeof CREDIT_ROLES)[number] {
  const role = CREDIT_ROLES.find((r) => r.name === name);
  if (!role) throw new Error(`Unknown CRediT role: "${name}"`);
  return role;
}
