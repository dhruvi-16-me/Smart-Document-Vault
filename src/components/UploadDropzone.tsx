import { useState } from "react";

type UploadDropzoneProps = {
  onFileSelected: (file: File) => void;
  onReject?: (message: string) => void;
  disabled?: boolean;
  uploading?: boolean;
};

function chooseFile(
  file: File | undefined,
  onFileSelected: (file: File) => void,
  onReject?: (message: string) => void,
) {
  if (!file) {
    return;
  }
  if (file.size === 0) {
    onReject?.("This file is empty.");
    return;
  }
  onFileSelected(file);
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
      className={`block rounded-xl border border-dashed px-6 py-10 text-center ${
        dragging && !inactive
          ? "border-stone-900 bg-stone-100"
          : "border-stone-300 bg-white"
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
        if (inactive) {
          return;
        }
        chooseFile(event.dataTransfer.files[0], onFileSelected, onReject);
      }}
    >
      <input
        type="file"
        className="sr-only"
        disabled={inactive}
        onChange={(event) => {
          chooseFile(event.target.files?.[0], onFileSelected, onReject);
          event.target.value = "";
        }}
      />
      <span className="block text-sm font-medium text-stone-900">
        {uploading ? "Uploading…" : "Drop any document here"}
      </span>
      <span className="mt-1 block text-sm text-stone-500">
        {uploading
          ? "Keep this page open"
          : "PDFs, photos, scans, Word and text files are read. Other files are stored as they are."}
      </span>
    </label>
  );
}
