import { documentTypeLabel, type DocumentRecord } from "../types.ts";

type DocumentCardProps = {
  document: DocumentRecord;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
};

const FILE_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WEBP",
};

function fileTypeLabel(mediaType: string) {
  return FILE_TYPE_LABELS[mediaType] ?? mediaType;
}

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
          {fileTypeLabel(document.media_type)} · {document.status}
          {documentTypeLabel(document.document_type)
            ? ` · ${documentTypeLabel(document.document_type)}`
            : ""}{" "}
          · {formatUploadedAt(document.created_at)}
        </span>
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
