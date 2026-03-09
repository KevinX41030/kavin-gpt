import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

const MarkdownLink = ({ href, ...props }: ComponentPropsWithoutRef<'a'>) => (
  <a href={href} rel="noreferrer" target="_blank" {...props} />
);

const MarkdownCode = ({ className, ...props }: ComponentPropsWithoutRef<'code'>) => (
  <code className={className} {...props} />
);

const MarkdownPre = (props: ComponentPropsWithoutRef<'pre'>) => (
  <pre className="markdown-pre" {...props} />
);

const MarkdownTable = (props: ComponentPropsWithoutRef<'table'>) => (
  <div className="markdown-table-wrapper">
    <table {...props} />
  </div>
);

const MarkdownMessage = ({ content }: MarkdownMessageProps) => (
  <ReactMarkdown
    className="markdown-body"
    components={{
      a: MarkdownLink,
      code: MarkdownCode,
      pre: MarkdownPre,
      table: MarkdownTable,
    }}
    remarkPlugins={[remarkGfm]}
  >
    {content}
  </ReactMarkdown>
);

export default MarkdownMessage;
