import { createContext, useContext } from "react";

export type ToastTone = "success" | "error" | "info";

export type ToastApi = (message: string, tone?: ToastTone) => void;

export const ToastContext = createContext<ToastApi>(() => {});

/** Show a short message in the corner, e.g. toast("Saved"). */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}
