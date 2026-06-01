import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  className?: string;
  content: string;
}

export function MarkdownContent({ className, content }: MarkdownContentProps) {
  return (
    <div className={["markdown-content", className].filter(Boolean).join(" ")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
