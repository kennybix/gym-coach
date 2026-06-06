"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* Renders the coach's / review's markdown with the app's dark theme. Element styles are
   mapped explicitly (no typography plugin) so spacing/lists/bold match the rest of the UI. */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (p) => <p className="my-2" {...p} />,
          pre: (p) => <pre className="my-2 overflow-x-auto rounded-lg bg-panel2 border border-line p-2.5 text-xs [&>code]:bg-transparent [&>code]:border-0 [&>code]:p-0" {...p} />,
          table: (p) => <div className="overflow-x-auto my-2"><table className="w-full text-xs border-collapse [&_td]:border [&_th]:border [&_td]:border-line [&_th]:border-line [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1" {...p} /></div>,
          strong: (p) => <strong className="font-semibold text-bone" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 my-2 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 my-2 space-y-1" {...p} />,
          li: (p) => <li className="leading-relaxed marker:text-dim" {...p} />,
          h1: (p) => <h2 className="font-display font-semibold text-base mt-3 mb-1" {...p} />,
          h2: (p) => <h2 className="font-display font-semibold text-base mt-3 mb-1" {...p} />,
          h3: (p) => <h3 className="font-display font-semibold text-sm mt-3 mb-1" {...p} />,
          a: (p) => <a className="text-volt underline" target="_blank" rel="noreferrer" {...p} />,
          code: (p) => <code className="px-1 py-0.5 bg-panel2 border border-line text-xs tnum" {...p} />,
          blockquote: (p) => <blockquote className="border-l-2 border-line pl-3 text-dim my-2" {...p} />,
          hr: () => <hr className="border-line my-3" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
