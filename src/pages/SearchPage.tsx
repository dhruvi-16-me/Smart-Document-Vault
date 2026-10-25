import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { listDocuments, searchDocuments, thumbnailUrl } from "../api.ts";
import { FileIcon, SearchIcon } from "../components/icons.tsx";
import { Badge, Button, EmptyState, GroupBadge, Notice, Skeleton } from "../components/ui.tsx";
import { groupColor, groupLabel, type DocumentRecord, type SearchHit } from "../types.ts";

type SearchPageProps = {
  onOpenDocument: (id: string, page?: number | null) => void;
};

const EXAMPLES = ["date of birth", "security deposit", "Class 12 marks", "policy expiry"];
// Common words that would highlight almost everything.
const STOPWORDS = new Set(["the", "and", "for", "what", "when", "where", "which", "with", "my", "is", "of", "in", "on", "a", "an", "to"]);
const SNIPPET_CHARS = 320;

export function SearchPage({ onOpenDocument }: SearchPageProps) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [group, setGroup] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listDocuments()
      .then((response) => {
        if (active) {
          setDocuments(response.documents);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not load indexing status.");
        }
      });
    return () => {
      active = false;
    };
  }, [results]);

  async function search(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setQuery(trimmed);
    setPending(true);
    setError(null);
    setGroup(null);
    try {
      const response = await searchDocuments(trimmed);
      setResults(response.results);
      setSearched(trimmed);
    } catch (failure) {
      setResults(null);
      setError(failure instanceof Error ? failure.message : "Search is unavailable.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query);
  }

  const indexing = documents.filter(
    (document) => document.index_status === "pending" || document.index_status === "processing",
  );
  const failed = documents.filter((document) => document.index_status === "failed");
  const thumbnails = new Map(documents.map((document) => [document.id, document.media_type]));
  const grouped = groupResults(results ?? []);
  const groupsInResults = [...new Set(grouped.map((item) => item.documentGroup ?? "other"))];
  const visible = grouped.filter((item) => group === null || (item.documentGroup ?? "other") === group);
  const terms = searchTerms(searched);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Search</h1>
        <p className="mt-1 text-stone-600">Find anything inside your documents, in plain words.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <label className="sr-only" htmlFor="search-query">
          Search query
        </label>
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            size={20}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-stone-500"
          />
          <input
            id="search-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try: when does my rent agreement end?"
            className="w-full rounded-xl border border-stone-300 bg-white py-3 pr-4 pl-12 text-base text-stone-900 shadow-sm placeholder:text-stone-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
        </div>
        <Button type="submit" variant="primary" disabled={pending} className="px-6">
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>

      {results === null && !pending ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-stone-600">Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void search(example)}
              className="rounded-full border border-stone-200 bg-white px-3 py-1 text-stone-700 hover:border-brand-300 hover:bg-brand-50"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {indexing.length > 0 ? (
        <Notice tone="brand">
          Making {indexing.length} document{indexing.length === 1 ? "" : "s"} searchable. They will
          show up in results shortly.
        </Notice>
      ) : null}
      {failed.length > 0 ? (
        <Notice tone="amber">
          {failed.length} document{failed.length === 1 ? " is" : "s are"} not searchable yet:{" "}
          {failed.map((document, index) => (
            <span key={document.id}>
              {index > 0 ? ", " : ""}
              <button
                type="button"
                onClick={() => onOpenDocument(document.id)}
                className="font-medium underline"
              >
                {document.filename}
              </button>
            </span>
          ))}
          . Open {failed.length === 1 ? "it" : "each one"} and choose Try again.
        </Notice>
      ) : null}
      {error ? <Notice tone="red">{error}</Notice> : null}

      {pending ? (
        <div className="space-y-4" aria-busy="true" aria-label="Searching">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : null}

      {!pending && results && results.length === 0 ? (
        <EmptyState icon={<SearchIcon size={36} />} title="Nothing matched">
          Try other words, or ask the assistant, which can combine facts from several documents.
        </EmptyState>
      ) : null}

      {!pending && grouped.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-600">
              {results?.length} passage{results?.length === 1 ? "" : "s"} in {grouped.length}{" "}
              document{grouped.length === 1 ? "" : "s"}, best match first
            </p>
            {groupsInResults.length > 1 ? (
              <div className="flex flex-wrap gap-2" aria-label="Filter results by category">
                <FilterChip active={group === null} onClick={() => setGroup(null)}>
                  All
                </FilterChip>
                {groupsInResults.map((key) => (
                  <FilterChip key={key} active={group === key} onClick={() => setGroup(key)} color={groupColor(key)}>
                    {groupLabel(key) ?? key}
                  </FilterChip>
                ))}
              </div>
            ) : null}
          </div>

          {visible.map((item, index) => (
            <article
              key={item.documentId}
              className="flex gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <Thumbnail id={item.documentId} mediaType={thumbnails.get(item.documentId)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenDocument(item.documentId)}
                      className="truncate text-left font-semibold text-stone-900 hover:text-brand-700"
                    >
                      {item.filename}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {index === 0 && group === null ? <Badge tone="brand">Best match</Badge> : null}
                      {item.documentLabel ? <Badge>{item.documentLabel}</Badge> : null}
                      {item.documentGroup ? (
                        <GroupBadge
                          color={groupColor(item.documentGroup)}
                          label={groupLabel(item.documentGroup) ?? item.documentGroup}
                        />
                      ) : null}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => onOpenDocument(item.documentId)}>
                    Open
                  </Button>
                </div>
                <ul className="mt-3 space-y-3">
                  {item.hits.map((hit) => (
                    <li key={hit.chunk_index} className="text-sm leading-relaxed text-stone-700">
                      {hit.page_number !== null ? (
                        <button
                          type="button"
                          onClick={() => onOpenDocument(hit.document_id, hit.page_number)}
                          className="mr-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                        >
                          Page {hit.page_number}
                        </button>
                      ) : null}
                      <Highlighted text={snippet(hit.text, terms)} terms={terms} />
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
          <p className="text-xs text-stone-600">
            Results are ranked by meaning. They show where your words appear, not that a statement
            is correct.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Thumbnail({ id, mediaType }: { id: string; mediaType?: string }) {
  const [failed, setFailed] = useState(false);
  const canShow = mediaType && /^(application\/pdf|image\/)/.test(mediaType) && !failed;
  return (
    <div className="hidden h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-100 sm:flex">
      {canShow ? (
        <img
          src={thumbnailUrl(id)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <FileIcon size={28} className="text-stone-500" />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-600 text-white"
          : "border border-stone-200 bg-white text-stone-700 hover:border-brand-300"
      }`}
    >
      {color ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) {
    return <>{text}</>;
  }
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded bg-brand-100 px-0.5 text-stone-900">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function searchTerms(query: string) {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

/** A window of the passage around the first matching word, so the match is visible. */
function snippet(text: string, terms: string[]) {
  const body = text.replace(/\s+/g, " ").trim();
  if (body.length <= SNIPPET_CHARS) {
    return body;
  }
  const lower = body.toLowerCase();
  const first = Math.min(...terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0), Infinity);
  const start = Number.isFinite(first) ? Math.max(0, first - 80) : 0;
  const end = Math.min(body.length, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function groupResults(results: SearchHit[]) {
  const groups: {
    documentId: string;
    filename: string;
    documentLabel: string | null;
    documentGroup: string | null;
    hits: SearchHit[];
  }[] = [];
  for (const hit of results) {
    const current = groups.find((group) => group.documentId === hit.document_id);
    if (current) {
      current.hits.push(hit);
    } else {
      groups.push({
        documentId: hit.document_id,
        filename: hit.filename,
        documentLabel: hit.document_label,
        documentGroup: hit.document_group,
        hits: [hit],
      });
    }
  }
  return groups;
}
