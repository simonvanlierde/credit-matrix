import type { Metadata } from "next";
import { AboutPage } from "@/components/AboutPage";
import { ReadingPage } from "@/components/ReadingPage";
import { citations } from "@/lib/citation";
import codemeta from "../../../codemeta.json";
// Server component: only the version string and the citation texts cross into the client bundle.
import packageJson from "../../../package.json";

export const metadata: Metadata = {
  title: "About · CRediT Matrix",
  description: "What CRediT Matrix is, how to cite it, whom it thanks, and what it sends where.",
  alternates: { canonical: "/about" },
};

export default function About() {
  return (
    <ReadingPage>
      <AboutPage version={packageJson.version} citations={citations(codemeta)} />
    </ReadingPage>
  );
}
