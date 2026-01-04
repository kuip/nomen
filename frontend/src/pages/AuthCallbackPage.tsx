import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const queryParams = new URLSearchParams(window.location.search);
      const errorCode = queryParams.get("error");
      const errorDescription = queryParams.get("error_description");

      if (errorCode) {
        console.error("OAuth error:", errorCode, errorDescription);
        setError(errorDescription || errorCode);
        setTimeout(() => navigate("/auth"), 3000);
        return;
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error("Session error:", sessionError);
        setError(sessionError.message);
        setTimeout(() => navigate("/auth"), 3000);
        return;
      }

      if (session) {
        navigate("/dashboard");
      } else {
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_IN" && session) {
            subscription.unsubscribe();
            navigate("/dashboard");
          }
        });

        setTimeout(() => {
          subscription.unsubscribe();
          if (!session) {
            setError("Authentication timeout");
            navigate("/auth");
          }
        }, 5000);
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        {error ? (
          <>
            <div className="text-red-500 mb-2">Authentication failed</div>
            <div className="text-sm opacity-70">{error}</div>
            <div className="text-xs opacity-50 mt-2">Redirecting...</div>
          </>
        ) : (
          <div>Processing authentication...</div>
        )}
      </div>
    </div>
  );
}
