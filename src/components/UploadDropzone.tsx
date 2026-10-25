import { useState } from "react";
import { UploadIcon } from "./icons.tsx";

type UploadDropzoneProps = {
  onFileSelected: (file: File) => void;
  onReject?: (message: string) => void;
  disabled?: boolean;
  uploading?: boolean;
};

function chooseFiles(
  files: FileList | null | undefined,
  onFileSelected: (file: File) => void,
  onReject?: (message: string) => void,
) {
  for (const file of Array.from(files ?? [])) {
    if (file.size === 0) {
      onReject?.(`${file.name} is empty.`);
    } else {
      onFileSelected(file);
    }
  }
}

export function UploadDropzone({
  onFileSelected,
  onReject,
  disabled = false,
  uploading = false,
}: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inactive = disabled || uploading;

  return (
    <label
      className={`flex items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-5 transition-colors ${
        dragging && !inactive
          ? "border-brand-500 bg-brand-50"
          : "border-stone-300 bg-white hover:border-brand-400 hover:bg-brand-50/40"
      } ${inactive ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!inactive) {
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!inactive) {
          chooseFiles(event.dataTransfer.files, onFileSelected, onReject);
        }
      }}
    >
      <input
        type="file"
        multiple
        className="sr-only"
        disabled={inactive}
        onChange={(event) => {
          chooseFiles(event.target.files, onFileSelected, onReject);
          event.target.value = "";
        }}
      />
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <UploadIcon size={24} />
      </span>
      <span>
        <span className="block font-medium text-stone-900">
          {uploading ? "Uploading…" : "Drop files here, or click to choose"}
        </span>
        <span className="mt-0.5 block text-sm text-stone-600">
          {uploading
            ? "Keep this page open"
            : "PDFs, photos, scans, Word and text files are read. Anything else is stored as it is."}
        </span>
      </span>
    </label>
  );
}
