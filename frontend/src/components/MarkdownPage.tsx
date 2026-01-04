import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { Link } from "react-router-dom";

interface MarkdownPageProps {
  filePath: string;
  title: string;
}

export default function MarkdownPage({ filePath }: MarkdownPageProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(filePath)
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading markdown:", err);
        setLoading(false);
      });
  }, [filePath]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link to="/" className="text-sm opacity-70 hover:opacity-100">
            ← Back to Home
          </Link>
        </div>

        <article className="prose prose-sm md:prose-base lg:prose-lg max-w-none">
          <style>{`
            .prose {
              color: var(--foreground);
            }
            .prose h1 {
              font-size: 2em;
              font-weight: 700;
              margin-bottom: 0.5em;
              border-bottom: 1px solid var(--border);
              padding-bottom: 0.3em;
            }
            .prose h2 {
              font-size: 1.5em;
              font-weight: 600;
              margin-top: 1.5em;
              margin-bottom: 0.5em;
            }
            .prose h3 {
              font-size: 1.25em;
              font-weight: 600;
              margin-top: 1.25em;
              margin-bottom: 0.5em;
            }
            .prose p {
              margin-bottom: 1em;
              line-height: 1.7;
            }
            .prose ul, .prose ol {
              margin-left: 1.5em;
              margin-bottom: 1em;
            }
            .prose li {
              margin-bottom: 0.5em;
            }
            .prose strong {
              font-weight: 600;
            }
            .prose hr {
              border: 0;
              border-top: 1px solid var(--border);
              margin: 2em 0;
            }
            .prose a {
              color: var(--accent);
              text-decoration: underline;
            }
            .prose a:hover {
              opacity: 0.8;
            }
            .prose code {
              background: var(--border);
              padding: 0.2em 0.4em;
              border-radius: 3px;
              font-size: 0.9em;
            }
          `}</style>
          <Markdown>{content}</Markdown>
        </article>
      </div>
    </div>
  );
}
