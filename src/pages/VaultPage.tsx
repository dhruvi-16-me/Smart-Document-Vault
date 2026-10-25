import { useCallback, useEffect, useState } from "react";
import { deleteDocument, listDocuments, uploadDocument } from "../api.ts";
import { DocumentCard } from "../components/DocumentCard.tsx";
import { SearchIcon, VaultIcon } from "../components/icons.tsx";
import { EmptyState, Notice, PageHeader, Skeleton, inputClass } from "../components/ui.tsx";
import { UploadDropzone } from "../components/UploadDropzone.tsx";
import { useToast } from "../toast.ts";
import { groupColor, groupLabel, type DocumentRecord } from "../types.ts";

type VaultPageProps = {
  onOpenDocument: (id: string) => void;
  onDocumentDeleted: (id: string) => void;
  initialGroup?: string | null;
};

export function VaultPage({ onOpenDocument, onDocumentDeleted, initialGroup = null }: VaultPageProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState<string | null>(initialGroup);
  const toast = useToast();

  const refreshDocuments = useCallback(async () => {
    const response = await listDocuments();
    setDocuments(response.documents);
  }, []);

  useEffect(() => {
    const pending = documents.some(
      (document) => document.status === "uploaded" || document.status === "processing",
    );
    if (!pending) {
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshDocuments();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [documents, refreshDocuments]);

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
          setError("Could not load documents. Start the backend on port 8765.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleFileSelected(file: File) {
    setError(null);
    setUploads((count) => count + 1);
    try {
      await uploadDocument(file);
      await refreshDocuments();
      toast(`Added ${file.name}`);
    } catch (uploadError) {
      setError(
        `${file.name}: ${uploadError instanceof Error ? uploadError.message : "Could not upload this file."}`,
      );
    } finally {
      setUploads((count) => count - 1);
    }
  }

  async function handleDelete(document: DocumentRecord) {
    const confirmed = window.confirm(
      `Delete "${document.filename}"?\n\nThe file and everything read from it will be removed from this computer.`,
    );
    if (!confirmed) {
      return;
    }
    setError(null);
    setDeletingId(document.id);
    try {
      await deleteDocument(document.id);
      onDocumentDeleted(document.id);
      await refreshDocuments();
      toast(`Deleted ${document.filename}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this document.");
    } finally {
      setDeletingId(null);
    }
  }

  const groups = countGroups(documents);
  const visible = documents.filter(
    (document) =>
      (group === null || (document.document_group ?? "other") === group) &&
      matchesFilter(document, filter),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your vault"
        description={
          documents.length > 0
            ? `${documents.length} document${documents.length === 1 ? "" : "s"}, all stored on this computer.`
            : "Everything you add stays on this computer."
        }
      />
      <UploadDropzone
        onFileSelected={(file) => void handleFileSelected(file)}
        onReject={setError}
        uploading={uploads > 0}
      />
      {error ? <Notice tone="red">{error}</Notice> : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading documents">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="aspect-[4/5] rounded-2xl" />
          ))}
        </div>
      ) : null}
      {!loading && documents.length === 0 && !error ? (
        <EmptyState icon={<VaultIcon size={40} />} title="Your vault is empty">
          Add marksheets, ID cards, certificates, bills, or any other file. They are read and
          organised automatically.
        </EmptyState>
      ) : null}

      {documents.length > 0 ? (
        <div className="space-y-4">
          <div className="relative">
            <SearchIcon
              size={18}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-500"
            />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by name, type, tag, or notes"
              aria-label="Filter documents"
              className={`${inputClass} py-2.5 pl-10`}
            />
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Filter by group">
            <GroupChip active={group === null} onClick={() => setGroup(null)} count={documents.length}>
              All
            </GroupChip>
            {groups.map(([key, count]) => (
              <GroupChip
                key={key}
                active={group === key}
                onClick={() => setGroup(key)}
                count={count}
                color={groupColor(key)}
              >
                {groupLabel(key) ?? key}
              </GroupChip>
            ))}
          </div>
        </div>
      ) : null}

      {documents.length > 0 && visible.length === 0 ? (
        <EmptyState title="No documents match">Try a different word or group.</EmptyState>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            onOpen={onOpenDocument}
            onDelete={(target) => void handleDelete(target)}
            deleting={deletingId === document.id}
          />
        ))}
      </div>
    </div>
  );
}

function GroupChip({
  active,
  onClick,
  count,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  color?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-600 text-white shadow-sm"
          : "border border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:text-brand-700"
      }`}
    >
      {color ? (
        <span
          className="h-2 w-2 rounded-full ring-1 ring-white/60"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ) : null}
      {children}
      <span className={active ? "text-brand-100" : "text-stone-500"}>{count}</span>
    </button>
  );
}

function countGroups(documents: DocumentRecord[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const key = document.document_group ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function matchesFilter(document: DocumentRecord, filter: string) {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const haystack = [
    document.filename,
    document.document_label,
    groupLabel(document.document_group),
    document.notes,
    ...document.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}
