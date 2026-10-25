import { useState } from "react";
import { thumbnailUrl } from "../api.ts";
import { fileTypeLabel, groupColor, groupLabel, statusBadge, type DocumentRecord } from "../types.ts";
import { FileIcon, TrashIcon } from "./icons.tsx";
import { Badge } from "./ui.tsx";

type DocumentCardProps = {
  document: DocumentRecord;
  onOpen: (id: string) => void;
  // Without onDelete the card is read-only, as on the home page.
  onDelete?: (document: DocumentRecord) => void;
  deleting?: boolean;
};

// Media types the API can draw a thumbnail for.
const THUMBNAIL_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
]);

function formatAdded(value: string) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function DocumentCard({ document, onOpen, onDelete, deleting = false }: DocumentCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const showThumbnail = THUMBNAIL_TYPES.has(document.media_type) && !thumbnailFailed;
  const status = statusBadge(document);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
      <span
        className="h-1 w-full"
        style={{ backgroundColor: groupColor(document.document_group) }}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => onOpen(document.id)}
        className="flex flex-1 flex-col text-left"
        aria-label={`Open ${document.filename}`}
      >
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-stone-100 bg-stone-100">
          {showThumbnail ? (
            <img
              src={thumbnailUrl(document.id)}
              alt=""
              loading="lazy"
              onError={() => setThumbnailFailed(true)}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <span className="flex flex-col items-center gap-2 text-stone-500">
              <FileIcon size={40} />
              <span className="text-xs font-medium">{fileTypeLabel(document)}</span>
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-stone-900" title={document.filename}>
              {document.filename}
            </p>
            <p className="flex items-center gap-1.5 truncate text-sm text-stone-600">
              {document.document_group ? (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: groupColor(document.document_group) }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="truncate">
                {document.document_label ?? "Not identified yet"}
                {document.document_group ? ` · ${groupLabel(document.document_group)}` : ""}
              </span>
            </p>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            {status ? (
              <Badge tone={status.tone} status>
                {status.label}
              </Badge>
            ) : null}
            {document.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} tone="blue">
                {tag}
              </Badge>
            ))}
            <span className="ml-auto text-xs text-stone-500">{formatAdded(document.created_at)}</span>
          </div>
        </div>
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(document)}
          disabled={deleting}
          aria-label={`Delete ${document.filename}`}
          className="absolute top-2 right-2 rounded-full bg-white/90 p-2 text-stone-600 opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100 disabled:opacity-50"
        >
          <TrashIcon size={16} />
        </button>
      ) : null}
    </article>
  );
}
