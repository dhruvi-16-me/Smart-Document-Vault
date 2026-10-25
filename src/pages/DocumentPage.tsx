import { useEffect, useState } from "react";
import {
  getDocument,
  getDocumentFields,
  retryFieldExtraction,
  updateDocumentField,
  updateDocumentType,
} from "../api.ts";
import type { DocumentField, DocumentFieldsResponse } from "../types.ts";
import { DOCUMENT_TYPES, documentTypeLabel, type DocumentRecord } from "../types.ts";

type DocumentPageProps = {
  documentId: string | null;
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

function isPending(document: DocumentRecord) {
  return document.status === "uploaded" || document.status === "processing";
}

function fieldsAreRunning(document: DocumentRecord) {
  return (
    document.field_extraction_status === "pending" ||
    document.field_extraction_status === "processing"
  );
}

export function DocumentPage({ documentId }: DocumentPageProps) {
  if (!documentId) {
    return (
      <section className="space-y-2">
        <h2 className="text-2xl font-semibold text-stone-900">Document</h2>
        <p className="text-sm text-stone-600">Open a document from the vault.</p>
      </section>
    );
  }

  return <DocumentDetail key={documentId} documentId={documentId} />;
}

function DocumentDetail({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer = 0;

    async function load() {
      try {
        const record = await getDocument(documentId);
        if (!active) {
          return;
        }
        setDocument(record);
        if (isPending(record) || (record.status === "ready" && fieldsAreRunning(record))) {
          timer = window.setTimeout(() => {
            void load();
          }, 800);
        }
      } catch {
        if (active) {
          setError("Could not load this document.");
        }
      }
    }

    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [documentId]);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-stone-900">
          {document?.filename ?? "Document"}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Text from PDFs and images appears here.
        </p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {!document && !error ? (
        <p className="text-sm text-stone-500">Loading document…</p>
      ) : null}
      {document ? (
        <>
          <dl className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">File type</dt>
              <dd className="mt-1 text-sm text-stone-900">
                {fileTypeLabel(document.media_type)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Status</dt>
              <dd className="mt-1 text-sm text-stone-900">{document.status}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Page count</dt>
              <dd className="mt-1 text-sm text-stone-900">
                {document.page_count === null ? "—" : document.page_count}
              </dd>
            </div>
          </dl>
          {!isPending(document) && document.status !== "failed" ? (
            <ClassificationPanel
              key={`${document.id}-${document.classification_status}-${document.document_type}`}
              document={document}
              onUpdated={setDocument}
            />
          ) : null}
          <ExtractedText document={document} />
          {document.status === "ready" ? (
            <ExtractedFields
              key={`${document.id}-${document.field_extraction_status}-${document.document_type}`}
              document={document}
              onDocumentUpdated={setDocument}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const STATUS_LABELS: Record<string, string> = {
  predicted: "Predicted",
  needs_review: "Needs review",
  failed: "Classification failed",
  verified: "Verified manually",
};

function ClassificationPanel({
  document,
  onUpdated,
}: {
  document: DocumentRecord;
  onUpdated: (document: DocumentRecord) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const typeLabel = documentTypeLabel(document.document_type);

  async function handleChange(nextType: string) {
    if (!nextType || nextType === document.document_type) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      onUpdated(await updateDocumentType(document.id, nextType));
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error
          ? saveFailure.message
          : "Could not update the document type.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="text-sm font-medium text-stone-900">Classification</h3>
      <dl className="mt-3 grid gap-4 border-t border-stone-200 pt-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Document type</dt>
          <dd className="mt-1 text-sm text-stone-900">{typeLabel ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Confidence</dt>
          <dd className="mt-1 text-sm text-stone-900">
            {document.classification_confidence === null
              ? "—"
              : document.classification_confidence.toFixed(2)}
          </dd>
          {document.classification_status === "predicted" ? (
            <p className="mt-1 text-xs text-stone-500">Uncalibrated model estimate</p>
          ) : null}
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">
            Classification status
          </dt>
          <dd className="mt-1 text-sm text-stone-900">
            {STATUS_LABELS[document.classification_status ?? ""] ?? "—"}
          </dd>
        </div>
      </dl>
      {document.classification_reasoning ? (
        <p className="mt-3 text-sm text-stone-700">{document.classification_reasoning}</p>
      ) : null}
      <label className="mt-4 grid gap-1 text-sm">
        <span className="font-medium text-stone-800">Correct the type</span>
        <select
          value={document.document_type ?? ""}
          disabled={saving}
          onChange={(event) => {
            void handleChange(event.target.value);
          }}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2"
        >
          <option value="" disabled>
            Choose a type
          </option>
          {DOCUMENT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {saveError ? <p className="mt-2 text-sm text-red-700">{saveError}</p> : null}
    </section>
  );
}

function fieldLabel(name: string) {
  return name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (item && typeof item === "object" && "subject" in item) {
            const subject = item as { subject?: string; marks?: string | null };
            return subject.marks
              ? `${subject.subject}: ${subject.marks}`
              : (subject.subject ?? "");
          }
          return String(item);
        })
        .filter(Boolean)
        .join(", ");
    }
  } catch {
    // Scalar values are shown as stored.
  }
  return value;
}

function ExtractedFields({
  document,
  onDocumentUpdated,
}: {
  document: DocumentRecord;
  onDocumentUpdated: (document: DocumentRecord) => void;
}) {
  const [payload, setPayload] = useState<DocumentFieldsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (fieldsAreRunning(document)) {
      return;
    }
    let active = true;
    getDocumentFields(document.id)
      .then((response) => {
        if (active) {
          setPayload(response);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not load extracted fields.");
        }
      });
    return () => {
      active = false;
    };
  }, [document]);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      onDocumentUpdated(await retryFieldExtraction(document.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not retry field extraction.");
    } finally {
      setRetrying(false);
    }
  }

  const status = document.field_extraction_status;
  const stored = new Map((payload?.fields ?? []).map((field) => [field.field_name, field]));
  const names = payload?.expected_fields ?? [];

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-stone-900">Extracted Fields</h3>
        {status === "failed" ? (
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              void retry();
            }}
            className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-800"
          >
            {retrying ? "Retrying…" : "Retry extraction"}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {fieldsAreRunning(document) ? (
        <p className="mt-3 text-sm text-stone-600">Extracting fields…</p>
      ) : null}
      {status === "needs_review" ? (
        <p className="mt-3 text-sm text-stone-600">
          {document.document_type
            ? "Not enough text to extract fields."
            : "Confirm the document type before fields can be extracted."}
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="mt-3 text-sm text-red-700">
          {document.field_extraction_error || "Field extraction failed."}
        </p>
      ) : null}
      {status === "completed" && names.length > 0 ? (
        <div className="mt-3 overflow-x-auto border-t border-stone-200 pt-3">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3 font-medium">Field</th>
                <th className="py-2 pr-3 font-medium">Value</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name) => {
                const field = stored.get(name);
                return field ? (
                  <FieldRow
                    key={field.id}
                    documentId={document.id}
                    field={field}
                    onUpdated={(updated) => {
                      setPayload((current) =>
                        current
                          ? {
                              ...current,
                              fields: current.fields.map((item) =>
                                item.id === updated.id ? updated : item,
                              ),
                            }
                          : current,
                      );
                    }}
                  />
                ) : (
                  <tr key={name} className="border-t border-stone-100">
                    <td className="py-2 pr-3 text-stone-800">{fieldLabel(name)}</td>
                    <td className="py-2 pr-3 text-stone-400">Missing</td>
                    <td className="py-2 pr-3 text-stone-400">Not extracted</td>
                    <td className="py-2 text-stone-400">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function FieldRow({
  documentId,
  field,
  onUpdated,
}: {
  documentId: string;
  field: DocumentField;
  onUpdated: (field: DocumentField) => void;
}) {
  const [value, setValue] = useState(displayValue(field.extracted_value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = field.verification_status === "verified";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await updateDocumentField(documentId, field.id, value));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this field.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="py-2 pr-3 text-stone-800">{fieldLabel(field.field_name)}</td>
      <td className="py-2 pr-3">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-lg border border-stone-300 px-2 py-1"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            void save();
          }}
          className="mt-1 text-xs text-stone-700 underline"
        >
          {saving ? "Saving…" : "Save and verify"}
        </button>
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </td>
      <td className="py-2 pr-3 text-stone-700">
        {verified ? "Verified by you" : "AI extracted"}
      </td>
      <td className="py-2 text-stone-600">{field.source_text || "—"}</td>
    </tr>
  );
}

function ExtractedText({ document }: { document: DocumentRecord }) {
  if (isPending(document)) {
    return <p className="text-sm text-stone-600">Processing document...</p>;
  }

  if (document.status === "failed") {
    return (
      <p className="text-sm text-red-700">
        {document.error_message || "Could not read text from this document."}
      </p>
    );
  }

  if (!document.full_text) {
    return (
      <p className="text-sm text-stone-600">
        No text could be extracted from this document.
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="text-sm font-medium text-stone-900">Extracted Text</h3>
      <pre className="mt-3 whitespace-pre-wrap border-t border-stone-200 pt-3 font-sans text-sm text-stone-800">
        {document.full_text}
      </pre>
    </section>
  );
}
