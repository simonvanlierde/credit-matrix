import { CensusDashboard } from "@/components/census/CensusDashboard";
import { authors } from "@/lib/json-ld";
// Server component: the counts are read at build time and arrive with the page,
// so it renders without a fetch. The same file is downloadable at /data/census.json.
import data from "../../../public/data/census.json";

const focus = data.years.find((y) => y.year === data.focus_year);

export const metadata = {
  title: "CRediT census · CRediT Matrix",
  description: focus
    ? `In ${focus.year}, ${Math.round((focus.with_roles / focus.articles) * 100)}% of open-access research articles in Europe PMC gave CRediT roles for at least one author. From ${(data.articles / 1e6).toFixed(1)} million articles.`
    : `How published papers use CRediT roles, from ${(data.articles / 1e6).toFixed(1)} million open-access articles in Europe PMC.`,
  alternates: { canonical: "/census" },
};

// Structured data, so the counts can show up in dataset search.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "CRediT census",
  description: metadata.description,
  url: "https://credit.duinlab.nl/census",
  version: data.dataset_version,
  license: data.license,
  creator: authors,
  isBasedOn: "https://europepmc.org",
  distribution: {
    "@type": "DataDownload",
    encodingFormat: "application/json",
    contentUrl: "https://credit.duinlab.nl/data/census.json",
  },
};

export default function CensusPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant built at build time, no user input
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <CensusDashboard data={data} />
    </>
  );
}
