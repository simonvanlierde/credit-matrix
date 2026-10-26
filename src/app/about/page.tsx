import type { Metadata } from "next";
import { AboutPage } from "@/components/AboutPage";
import { ReadingPage } from "@/components/ReadingPage";
// Server component: only the version string crosses into the client bundle.
import packageJson from "../../../package.json";

export const metadata: Metadata = {
  title: "About · CRediT Matrix",
  description: "What CRediT Matrix is, how to cite it, whom it thanks, and what it sends where.",
};

export default function About() {
  return (
    <ReadingPage>
      <AboutPage version={packageJson.version} />
    </ReadingPage>
  );
}
