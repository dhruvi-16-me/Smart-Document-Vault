import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ToastContext, type ToastTone } from "../toast.ts";
import { CloseIcon } from "./icons.tsx";

type Toast = { id: number; message: string; tone: ToastTone };

const TOAST_MS = 3500;

const TONES: Record<ToastTone, { box: string; symbol: string }> = {
  success: { box: "border-emerald-200 bg-white text-stone-800", symbol: "✓" },
  error: { box: "border-red-200 bg-white text-stone-800", symbol: "×" },
  info: { box: "border-stone-200 bg-white text-stone-800", symbol: "i" },
};

const SYMBOL_COLORS: Record<ToastTone, string> = {
  success: "bg-emerald-600",
  error: "bg-red-600",
  info: "bg-navy-800",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${TONES[toast.tone].box}`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white ${SYMBOL_COLORS[toast.tone]}`}
              aria-hidden="true"
            >
              {TONES[toast.tone].symbol}
            </span>
            {toast.message}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="ml-1 text-stone-500 hover:text-stone-800"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
