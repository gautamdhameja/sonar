import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CitationVerification } from "../types";

interface MarkdownContentProps {
  className?: string;
  content: string;
  citation?: CitationVerification | null;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode };
    return textFromNode(props.children);
  }
  return "";
}

function normalizeRenderedClaimText(value: string): string {
  return value
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function claimClassName(children: ReactNode, citation?: CitationVerification | null): string | undefined {
  const claims = citation?.claims ?? [];
  if (claims.length === 0) return undefined;

  const text = normalizeRenderedClaimText(textFromNode(children));
  const claim = claims.find(
    (item) => item.status === "unverifiable" && text.includes(normalizeRenderedClaimText(item.text)),
  );
  return claim ? "claim-unverifiable" : undefined;
}

export function MarkdownContent({ className, content, citation }: MarkdownContentProps) {
  return (
    <div className={["markdown-content", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        components={{
          li({ children, className: itemClassName, ...props }) {
            return (
              <li className={[itemClassName, claimClassName(children, citation)].filter(Boolean).join(" ")} {...props}>
                {children}
              </li>
            );
          },
          p({ children, className: paragraphClassName, ...props }) {
            return (
              <p
                className={[paragraphClassName, claimClassName(children, citation)].filter(Boolean).join(" ")}
                {...props}
              >
                {children}
              </p>
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
