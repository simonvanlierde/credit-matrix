import { AboutPage } from "@/components/AboutPage";
import { ReadingPage } from "@/components/ReadingPage";
import { citations } from "@/lib/citation-files";
import packageJson from "../../../package.json";

export const metadata = {
  title: "About · CRediT Matrix",
  description: "What CRediT Matrix is, how to cite it, whom it thanks, and what it sends where.",
  alternates: { canonical: "/about" },
};

export default function About() {
  return (
    <ReadingPage>
      <AboutPage version={packageJson.version} citations={citations} />
    </ReadingPage>
  );
}
