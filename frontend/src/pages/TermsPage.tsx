import MarkdownPage from "@/components/MarkdownPage";

export default function TermsPage() {
  return <MarkdownPage filePath={`${import.meta.env.BASE_URL}terms.md`} title="Terms of Service" />;
}
