import React, { Suspense, useEffect, useState } from "react";

const Lottie = React.lazy(() => import("lottie-react"));
const TUITION_AI_LOTTIE_URL: string | null = "/ai-bot.json";

export function TuitionAiAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const [animationData, setAnimationData] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    async function loadAnimation() {
      if (!TUITION_AI_LOTTIE_URL) return;
      try {
        const response = await fetch(TUITION_AI_LOTTIE_URL);
        const data = await response.json();
        if (mounted) setAnimationData(data);
      } catch {
        if (mounted) setAnimationData(null);
      }
    }
    void loadAnimation();
    return () => {
      mounted = false;
    };
  }, []);

  const className = size === "sm" ? "h-12 w-12" : size === "lg" ? "h-16 w-16" : "h-14 w-14";
  const fallback = (
    <div className={`${className} flex items-center justify-center rounded-2xl bg-blue-600 text-lg shadow-sm`}>
      🤖
    </div>
  );
  if (animationData) {
    return (
      <Suspense fallback={fallback}>
        <Lottie animationData={animationData} loop autoplay className={`${className} pointer-events-none`} />
      </Suspense>
    );
  }
  return fallback;
}
