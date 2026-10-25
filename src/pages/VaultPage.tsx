import { useCallback, useEffect, useState } from "react";
import { deleteDocument, listDocuments, uploadDocument } from "../api.ts";
import { DocumentCard } from "../components/DocumentCard.tsx";
import { UploadDropzone } from "../components/UploadDropzone.tsx";
import type { DocumentRecord } from "../types.ts";

type VaultPageProps = {
  onOpenDocument: (id: string) => void;
  onDocumentDeleted: (id: string) => void;
};

export function VaultPage({ onOpenDocument, onDocumentDeleted }: VaultPageProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setUploading(true);
    try {
      await uploadDocument(file);
      await refreshDocuments();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload this file.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setDeletingId(id);
    try {
      await deleteDocument(id);
      onDocumentDeleted(id);
      await refreshDocuments();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete this document.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-stone-900">Vault</h2>
        <p className="mt-1 text-sm text-stone-600">
          PDFs and images are stored on this computer.
        </p>
      </div>
      <UploadDropzone
        onFileSelected={handleFileSelected}
        onReject={setError}
        uploading={uploading}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm text-stone-500">Loading documents…</p> : null}
      {!loading && documents.length === 0 ? (
        <p className="text-sm text-stone-500">No documents stored yet.</p>
      ) : null}
      <div className="grid gap-3">
        {documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            onOpen={onOpenDocument}
            onDelete={handleDelete}
            deleting={deletingId === document.id}
          />
        ))}
      </div>
    </section>
  );
}
