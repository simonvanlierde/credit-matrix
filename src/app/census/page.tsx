import type { Metadata } from "next";
import { CensusDashboard } from "@/components/census/CensusDashboard";
// Server component: the counts are read at build time and arrive with the page,
// so it renders without a fetch. The same file is downloadable at /data/census.json.
import data from "../../../public/data/census.json";

export const metadata: Metadata = {
  title: "CRediT census · CRediT Matrix",
  description: `How published papers use CRediT roles, from ${(data.articles / 1e6).toFixed(1)} million open-access articles in Europe PMC.`,
};

export default function CensusPage() {
  return <CensusDashboard data={data} />;
}
