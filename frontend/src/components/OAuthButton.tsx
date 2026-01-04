import { supabase } from "@/lib/supabase";

interface OAuthButtonProps {
  provider:
    | "google"
    | "github"
    | "facebook"
    | "twitter"
    | "discord"
    | "linkedin_oidc"
    | "tiktok";
  icon: React.ReactNode;
  label: string;
}

export default function OAuthButton({
  provider,
  icon,
  label,
}: OAuthButtonProps) {
  const handleClick = async () => {
    const basePath = import.meta.env.BASE_URL;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider as any,
      options: {
        redirectTo: `${window.location.origin}${basePath}auth/callback`,
      },
    });
    if (error) {
      console.error("OAuth error:", error);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded border hover:bg-opacity-5 hover:bg-foreground transition-colors"
      style={{ borderColor: "var(--border)" }}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}
