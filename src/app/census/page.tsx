import type { Metadata } from "next";
import { CensusDashboard } from "@/components/census/CensusDashboard";
// Server component: the counts are read at build time and arrive with the page,
// so it renders without a fetch. The same file is downloadable at /data/census.json.
import data from "../../../public/data/census.json";

const focus = data.years.find((y) => y.year === data.focus_year);

export const metadata: Metadata = {
  title: "CRediT census · CRediT Matrix",
  description: focus
    ? `In ${focus.year}, ${Math.round((focus.with_roles / focus.articles) * 100)}% of open-access research articles in Europe PMC gave CRediT roles for at least one author. From ${(data.articles / 1e6).toFixed(1)} million articles.`
    : `How published papers use CRediT roles, from ${(data.articles / 1e6).toFixed(1)} million open-access articles in Europe PMC.`,
};

export default function CensusPage() {
  return <CensusDashboard data={data} />;
}
