import React, { useEffect, useState } from "react";

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Starting now";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }
  return `${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

export const LiveCountdown = React.memo(function LiveCountdown({
  targetTimeMs,
  prefix = "",
}: {
  targetTimeMs: number;
  prefix?: string;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((targetTimeMs - Date.now()) / 1_000))
  );

  useEffect(() => {
    const update = () => {
      setSecondsLeft(Math.max(0, Math.floor((targetTimeMs - Date.now()) / 1_000)));
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [targetTimeMs]);

  return (
    <>
      {prefix}
      {formatCountdown(secondsLeft)}
    </>
  );
});
