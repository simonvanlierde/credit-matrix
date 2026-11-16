import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import type { DocPart, LiveTarget } from "./live-markers";

const LiveExample = lazy(() => import("./LiveExample"));

// A missing live chunk must leave the prerendered guide readable.
class LiveFailure extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function LiveSlot({ target }: { target: LiveTarget }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div data-doc-live={target} data-pagefind-ignore>
      {mounted && (
        <LiveFailure>
          <Suspense fallback={null}>
            <LiveExample target={target} />
          </Suspense>
        </LiveFailure>
      )}
    </div>
  );
}

/** Recover the server's static fragments before hydration, without shipping their Markdown. */
export function readDocParts(article: Element | null): DocPart[] {
  if (!article) return [""];
  if (!article.querySelector(":scope > [data-doc-live]")) return [article.innerHTML];
  return Array.from(article.children, (part) => {
    const target = part.getAttribute("data-doc-live");
    return target ? { live: target as LiveTarget } : part.innerHTML;
  });
}

// shortcut: only the entities marked and the browser write; a heading with another named entity
// (&copy;) would hydrate with different text, so decode those too if a guide ever uses one.
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: "\u00a0" };

/**
 * The article's section headings, read from the same HTML on the server and in the browser, so the
 * outline is in the prerendered page and hydrates without changing.
 */
export function readOutline(parts: DocPart[]): { id: string; title: string }[] {
  return parts.flatMap((part) =>
    typeof part === "string"
      ? Array.from(part.matchAll(/<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g), ([, id = "", html = ""]) => ({
          id,
          title: html
            .replace(/<[^>]*>/g, "")
            .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity, name: string) => ENTITIES[name] ?? entity),
        }))
      : [],
  );
}

export function DocArticle({ parts }: { parts: DocPart[] }) {
  if (parts.length === 1 && typeof parts[0] === "string") {
    return (
      <article
        lang="en"
        data-pagefind-body
        className="document docs-article"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown from the repo
        dangerouslySetInnerHTML={{ __html: parts[0] }}
      />
    );
  }
  return (
    <article lang="en" data-pagefind-body className="document docs-article">
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: build-time fragments never reorder
            key={index}
            data-doc-static
            // biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown from the repo
            dangerouslySetInnerHTML={{ __html: part }}
          />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: build-time fragments never reorder
          <LiveSlot key={index} target={part.live} />
        ),
      )}
    </article>
  );
}
