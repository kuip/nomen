import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        navigate("/dashboard");
      }
    };

    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-lg text-center space-y-6">
        <div className="flex justify-center mb-4">
          <img
            src={`${import.meta.env.BASE_URL}nomen.svg`}
            alt="Nomen"
            width={120}
            height={120}
            className="dark:invert"
          />
        </div>
        <h1 className="text-4xl font-semibold">Nomen</h1>
        <p className="opacity-70">
          Collate identity proofs from multiple platforms and merge profiles
        </p>
        <div className="flex gap-4 justify-center mt-8">
          <Link
            to="/auth"
            className="px-6 py-3 rounded font-medium"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
}
