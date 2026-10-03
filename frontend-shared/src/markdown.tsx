import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// react-markdown never renders raw HTML and strips javascript: URLs, so model output is safe to render.
export function MarkdownText({ text }: { text: string }): ReactNode {
  return <div className="markdown">
    <Markdown remarkPlugins={[remarkGfm]} components={{
      a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
      table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
    }}>{text}</Markdown>
  </div>;
}
