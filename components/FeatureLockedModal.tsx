import React, { useEffect, useMemo } from "react";
import { LockKeyhole, MessageCircle, X } from "lucide-react";

import type { FeatureLockDetail } from "../services/featureAccess";

const MIAN_ADMIN_WHATSAPP = "923189995518";

export function FeatureLockedModal({
  feature,
  onClose,
}: {
  feature: FeatureLockDetail | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!feature) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [feature, onClose]);

  const whatsappUrl = useMemo(() => {
    if (!feature) return "#";

    const message =
      `Assalamu Alaikum Mian Admin. ` +
      `Please activate the "${feature.title}" feature for our department ` +
      `in the IVS platform. Kindly share the requirements and next steps. Thank you.`;

    return `https://wa.me/${MIAN_ADMIN_WHATSAPP}?text=${encodeURIComponent(
      message
    )}`;
  }, [feature]);

  if (!feature) return null;

  return (
    <div
      className="
        fixed inset-0 z-[150]
        flex items-center justify-center
        bg-slate-950/55 p-4
        backdrop-blur-md
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-locked-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="
          relative w-full max-w-[460px]
          overflow-hidden rounded-[30px]
          border border-white/70
          bg-white
          shadow-[0_35px_110px_rgba(15,23,42,0.38)]
          dark:border-slate-700
          dark:bg-slate-900
        "
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full bg-indigo-200/55 blur-3xl dark:bg-indigo-500/15" />

        <div className="pointer-events-none absolute -bottom-28 -left-24 h-60 w-60 rounded-full bg-cyan-100/75 blur-3xl dark:bg-cyan-500/10" />

        <div className="absolute left-0 top-0 h-1.5 w-full bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-400" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="
            absolute right-4 top-4 z-20
            flex h-10 w-10 items-center justify-center
            rounded-2xl border border-slate-200
            bg-white/90 text-slate-500
            shadow-sm transition
            hover:bg-slate-50 hover:text-slate-950
            active:scale-[0.97]
            dark:border-slate-700
            dark:bg-slate-800
            dark:text-slate-300
          "
        >
          <X size={18} />
        </button>

        <div className="relative z-10 p-7 sm:p-8">
          <div
            className="
              flex h-14 w-14 items-center justify-center
              rounded-[20px]
              border border-indigo-100
              bg-gradient-to-br from-indigo-50 to-blue-50
              text-indigo-700
              shadow-[0_15px_32px_rgba(79,70,229,0.16)]
              dark:border-indigo-500/20
              dark:from-indigo-500/15
              dark:to-blue-500/10
              dark:text-indigo-300
            "
          >
            <LockKeyhole size={26} />
          </div>

          <h2
            id="feature-locked-title"
            className="
              mt-5 text-2xl font-black
              tracking-tight text-slate-950
              dark:text-white
            "
          >
            {feature.title} is unavailable
          </h2>

          <p
            className="
              mt-3 text-sm font-semibold
              leading-6 text-slate-600
              dark:text-slate-300
            "
          >
            This option is currently not available for your department.
            Please contact Mian Admin to request access.
          </p>

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="
                inline-flex min-h-11 items-center justify-center
                rounded-2xl border border-slate-200
                bg-white px-5 py-2.5
                text-sm font-black text-slate-700
                shadow-sm transition
                hover:bg-slate-50
                active:scale-[0.98]
                dark:border-slate-700
                dark:bg-slate-800
                dark:text-slate-200
              "
            >
              Close
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="
                inline-flex min-h-11 items-center justify-center gap-2
                rounded-2xl
                bg-gradient-to-r from-emerald-600 to-green-600
                px-5 py-2.5
                text-sm font-black text-white
                shadow-[0_18px_38px_-16px_rgba(5,150,105,0.85)]
                transition
                hover:brightness-110
                active:scale-[0.98]
              "
            >
              <MessageCircle size={17} />
              Contact Administrator
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
