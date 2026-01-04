import MarkdownPage from "@/components/MarkdownPage";

export default function PrivacyPage() {
  return <MarkdownPage filePath={`${import.meta.env.BASE_URL}privacy.md`} title="Privacy Policy" />;
}
