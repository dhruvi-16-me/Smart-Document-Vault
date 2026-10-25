import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listDocuments, searchDocuments } from "../api.ts";
import type { DocumentRecord, SearchHit } from "../types.ts";

export function SearchPage({ onOpenDocument }: { onOpenDocument: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await searchDocuments(trimmed);
      setResults(response.results);
    } catch (failure) {
      setResults(null);
      setError(failure instanceof Error ? failure.message : "Search is unavailable.");
    } finally {
      setPending(false);
    }
  }

  const indexing = documents.filter((document) =>
    document.index_status === "pending" || document.index_status === "processing",
  );
  const failed = documents.filter((document) => document.index_status === "failed");
  const groups = groupResults(results ?? []);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-stone-900">Search</h2>
        <p className="mt-1 text-sm text-stone-600">
          Search your documents in plain language. A similarity score measures retrieval
          relevance, not whether the text is factually correct.
        </p>
      </div>
      {indexing.length > 0 ? (
        <p className="text-sm text-stone-600">
          Indexing {indexing.length} document{indexing.length === 1 ? "" : "s"}…
        </p>
      ) : null}
      {failed.length > 0 ? (
        <p className="text-sm text-red-700">
          {failed.length} document{failed.length === 1 ? "" : "s"} could not be indexed.
          {" "}
          {failed[0].index_error}
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label className="sr-only" htmlFor="search-query">
          Search query
        </label>
        <input
          id="search-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your documents"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Searching…" : "Search"}
        </button>
      </form>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {results && results.length === 0 ? (
        <p className="text-sm text-stone-500">No matching passages yet.</p>
      ) : null}
      {groups.map((group) => (
        <article key={group.documentId} className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-stone-900">{group.filename}</h3>
              {group.documentLabel ? (
                <p className="mt-1 text-xs uppercase tracking-wide text-stone-500">
                  {group.documentLabel}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onOpenDocument(group.documentId)}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
            >
              Open document
            </button>
          </div>
          <ul className="mt-3 space-y-3">
            {group.hits.map((hit) => (
              <li key={`${hit.document_id}-${hit.chunk_index}`} className="text-sm text-stone-800">
                <p className="text-xs text-stone-500">
                  {hit.page_number === null ? "Page unknown" : `Page ${hit.page_number}`}
                  {" · "}
                  Relevance {hit.score.toFixed(2)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{hit.text}</p>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function groupResults(results: SearchHit[]) {
  const groups: {
    documentId: string;
    filename: string;
    documentLabel: string | null;
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
        hits: [hit],
      });
    }
  }
  return groups;
}
