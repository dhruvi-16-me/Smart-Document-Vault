import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
  secondary: "border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50",
  ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
  danger: "text-red-600 hover:bg-red-50",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  const sizing = size === "sm" ? "gap-1.5 px-2.5 py-1.5 text-sm" : "gap-2 px-4 py-2 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export type BadgeTone = "brand" | "stone" | "green" | "amber" | "red" | "blue";

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  stone: "bg-stone-100 text-stone-700 ring-stone-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
};

// Status badges carry a symbol too, so their meaning never depends on colour alone.
const STATUS_SYMBOLS: Partial<Record<BadgeTone, string>> = {
  amber: "!",
  red: "×",
  blue: "…",
};

export function Badge({
  tone = "stone",
  status = false,
  children,
}: {
  tone?: BadgeTone;
  status?: boolean;
  children: ReactNode;
}) {
  const symbol = status ? STATUS_SYMBOLS[tone] : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {symbol ? (
        <span aria-hidden="true" className="font-bold">
          {symbol}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/** A category name with its colour dot; the text stays in ink colour. */
export function GroupBadge({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-stone-200 ring-inset">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-stone-200/70 ${className}`} aria-hidden="true" />;
}

export function Card({
  children,
  className = "",
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {title || actions ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h3 className="text-base font-semibold text-stone-900">{title}</h3> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {description ? <p className="mt-1 text-stone-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-stone-500">{icon}</div> : null}
      <p className="font-medium text-stone-800">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-stone-600">{children}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-stone-600" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-brand-600" />
      {label}
    </span>
  );
}

export function Notice({
  tone = "amber",
  children,
}: {
  tone?: "amber" | "red" | "brand";
  children: ReactNode;
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800",
    brand: "border-brand-200 bg-brand-50 text-brand-800",
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm placeholder:text-stone-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";
