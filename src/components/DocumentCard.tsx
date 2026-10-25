import {
  DOCUMENT_STATUS_LABELS,
  fileTypeLabel,
  groupLabel,
  type DocumentRecord,
} from "../types.ts";

type DocumentCardProps = {
  document: DocumentRecord;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
};

function formatUploadedAt(value: string) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function DocumentCard({
  document,
  onOpen,
  onDelete,
  deleting,
}: DocumentCardProps) {
  return (
    <article className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
      <button
        type="button"
        onClick={() => onOpen(document.id)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate font-medium text-stone-900">
          {document.filename}
        </span>
        <span className="mt-1 block text-sm text-stone-500">
          {[
            document.document_label,
            groupLabel(document.document_group),
            fileTypeLabel(document),
            DOCUMENT_STATUS_LABELS[document.status] ?? document.status,
            formatUploadedAt(document.created_at),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {document.tags.length > 0 ? (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {document.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700"
              >
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => onDelete(document.id)}
        disabled={deleting}
        className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 disabled:opacity-60"
      >
        {deleting ? "Deleting" : "Delete"}
      </button>
    </article>
  );
}
