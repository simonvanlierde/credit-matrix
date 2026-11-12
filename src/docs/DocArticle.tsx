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

export function DocArticle({ parts }: { parts: DocPart[] }) {
  if (parts.length === 1 && typeof parts[0] === "string") {
    return (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown from the repo
      <article lang="en" data-pagefind-body className="document" dangerouslySetInnerHTML={{ __html: parts[0] }} />
    );
  }
  return (
    <article lang="en" data-pagefind-body className="document">
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
