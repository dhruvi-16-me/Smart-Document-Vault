import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getDashboard, listDocuments } from "../api.ts";
import { DocumentCard } from "../components/DocumentCard.tsx";
import { UploadIcon, VaultIcon } from "../components/icons.tsx";
import { Badge, Button, Card, EmptyState, Notice, Skeleton } from "../components/ui.tsx";
import {
  GROUP_COLORS,
  groupColor,
  groupLabel,
  statusBadge,
  type DocumentRecord,
  type UpcomingDate,
} from "../types.ts";

type HomePageProps = {
  onOpenDocument: (id: string, page?: number | null) => void;
  onOpenVault: (group: string | null) => void;
};

// Dates this close count as "coming up" in the summary tile.
const SOON_DAYS = 90;
const RECENT_COUNT = 3;

const ROLE_LABELS: Record<string, string> = {
  expires: "Expires",
  due: "Due",
  renewal: "Renewal",
};

export function HomePage({ onOpenDocument, onOpenVault }: HomePageProps) {
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingDate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listDocuments(), getDashboard()])
      .then(([list, dashboard]) => {
        if (active) {
          setDocuments(list.documents);
          setUpcoming(dashboard.upcoming);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not load your vault. Start the backend on port 8765.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <Notice tone="red">{error}</Notice>;
  }
  if (documents === null) {
    return <HomeSkeleton />;
  }
  if (documents.length === 0) {
    return (
      <div className="space-y-6">
        <Greeting />
        <EmptyState icon={<VaultIcon size={40} />} title="Your vault is empty">
          <p>Add marksheets, ID cards, certificates, bills, or any other file. They are read and organised on this computer.</p>
          <Button variant="primary" className="mt-4" onClick={() => onOpenVault(null)}>
            <UploadIcon size={18} /> Add documents
          </Button>
        </EmptyState>
      </div>
    );
  }

  const attention = documents.filter((document) => statusBadge(document) !== null);
  const soon = upcoming.filter((item) => item.days_left <= SOON_DAYS);
  const groups = countGroups(documents);
  const addedThisWeek = documents.filter((document) => daysSince(document.created_at) <= 7).length;

  return (
    <div className="space-y-8">
      <Greeting />

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Documents"
          value={documents.length}
          detail={addedThisWeek > 0 ? `${addedThisWeek} added this week` : "None added this week"}
        />
        <StatTile
          label="Need attention"
          value={attention.length}
          detail={attention.length > 0 ? "To check or finish" : "Everything is in order"}
          warning={attention.length > 0}
        />
        <StatTile
          label="Coming up"
          value={soon.length}
          detail={
            soon.length > 0
              ? `${soon[0].field_label}: ${relativeDays(soon[0].days_left)}`
              : `Nothing due in the next ${SOON_DAYS} days`
          }
          warning={soon.some((item) => item.days_left <= 30)}
        />
        <StatTile
          label="Categories"
          value={groups.length}
          detail={groups.slice(0, 2).map(([key]) => groupLabel(key)).join(", ")}
        />
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Coming up">
          {upcoming.length === 0 ? (
            <p className="text-sm text-stone-600">
              No expiry or due dates found yet. They appear here when documents like licences,
              policies, or bills are read.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {upcoming.map((item) => (
                <li key={`${item.document_id}-${item.field_label}-${item.date}`}>
                  <button
                    type="button"
                    onClick={() => onOpenDocument(item.document_id, item.page_number)}
                    className="flex w-full items-center gap-3 py-3 text-left hover:bg-stone-50"
                  >
                    <DateChip date={item.date} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-stone-900">
                        {ROLE_LABELS[item.date_role] ?? item.field_label}: {item.document_label ?? item.filename}
                      </span>
                      <span className="block truncate text-sm text-stone-600">
                        {item.field_label} · {item.filename}
                      </span>
                    </span>
                    <DaysBadge days={item.days_left} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Needs attention">
          {attention.length === 0 ? (
            <p className="text-sm text-stone-600">Every document was read and indexed.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {attention.slice(0, 6).map((document) => {
                const status = statusBadge(document);
                return (
                  <li key={document.id}>
                    <button
                      type="button"
                      onClick={() => onOpenDocument(document.id)}
                      className="flex w-full items-center gap-3 py-3 text-left hover:bg-stone-50"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: groupColor(document.document_group) }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-stone-900">{document.filename}</span>
                        <span className="block truncate text-sm text-stone-600">
                          {document.document_label ?? "Not identified yet"}
                        </span>
                      </span>
                      {status ? (
                        <Badge tone={status.tone} status>
                          {status.label}
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-stone-900">Browse by category</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map(([key, count]) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => onOpenVault(key)}
                className="flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <span
                  className="h-8 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: GROUP_COLORS[key] ?? GROUP_COLORS.other }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-medium text-stone-800">{groupLabel(key)}</span>
                <span className="shrink-0 text-sm whitespace-nowrap text-stone-600">
                  {count} document{count === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">Recently added</h2>
          <Button variant="ghost" size="sm" onClick={() => onOpenVault(null)}>
            View all
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {documents.slice(0, RECENT_COUNT).map((document) => (
            <DocumentCard key={document.id} document={document} onOpen={onOpenDocument} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Greeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{greeting}</h1>
      <p className="mt-1 text-stone-600">Here is what is in your vault.</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string;
  value: number;
  detail: ReactNode;
  warning?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <dt className="flex items-center gap-2 text-sm font-medium text-stone-600">
        {label}
        {warning ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white" aria-label="Needs a look">
            !
          </span>
        ) : null}
      </dt>
      <dd className="mt-2 text-3xl font-semibold text-stone-900">{value.toLocaleString()}</dd>
      <dd className="mt-1 truncate text-sm text-stone-600">{detail}</dd>
    </div>
  );
}

function DateChip({ date }: { date: string }) {
  const parsed = new Date(`${date}T00:00:00`);
  return (
    <span className="flex w-12 shrink-0 flex-col items-center rounded-lg border border-stone-200 bg-cream py-1 text-center">
      <span className="text-[10px] font-semibold tracking-wide text-brand-700 uppercase">
        {parsed.toLocaleDateString(undefined, { month: "short" })}
      </span>
      <span className="text-lg leading-tight font-semibold text-stone-900">{parsed.getDate()}</span>
      <span className="text-[10px] text-stone-600">{parsed.getFullYear()}</span>
    </span>
  );
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <Badge tone="red" status>
        Expired {relativeDays(days)}
      </Badge>
    );
  }
  return (
    <Badge tone={days <= 30 ? "amber" : "stone"} status={days <= 30}>
      {relativeDays(days)}
    </Badge>
  );
}

function relativeDays(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function daysSince(createdAt: string) {
  const created = new Date(`${createdAt.replace(" ", "T")}Z`).getTime();
  return (Date.now() - created) / 86_400_000;
}

function countGroups(documents: DocumentRecord[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const key = document.document_group ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function HomeSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading your vault">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
