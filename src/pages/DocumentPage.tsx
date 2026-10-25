import { useEffect, useState } from "react";
import {
  getDocument,
  getDocumentFields,
  getDocumentOptions,
  retryFieldExtraction,
  updateDocument,
  updateDocumentField,
} from "../api.ts";
import type {
  DocumentField,
  DocumentFieldsResponse,
  DocumentOptions,
  DocumentUpdate,
} from "../types.ts";
import {
  DOCUMENT_STATUS_LABELS,
  READABLE_FORMATS_TEXT,
  fileTypeLabel,
  groupLabel,
  type DocumentRecord,
} from "../types.ts";

type DocumentPageProps = {
  documentId: string | null;
};

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
          Type, tags, notes, extracted text, and fields for this document.
        </p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {!document && !error ? (
        <p className="text-sm text-stone-500">Loading document…</p>
      ) : null}
      {document ? (
        <>
          <dl className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">File type</dt>
              <dd className="mt-1 text-sm text-stone-900">
                {fileTypeLabel(document)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Status</dt>
              <dd className="mt-1 text-sm text-stone-900">
                {DOCUMENT_STATUS_LABELS[document.status] ?? document.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Page count</dt>
              <dd className="mt-1 text-sm text-stone-900">
                {document.page_count === null ? "—" : document.page_count}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">OCR confidence</dt>
              <dd className="mt-1 text-sm text-stone-900">
                {document.ocr_confidence === null ? "—" : `${Math.round(document.ocr_confidence)}%`}
              </dd>
            </div>
          </dl>
          {document.low_confidence_pages.length > 0 ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Text was hard to read on {pageList(document.low_confidence_pages)}. Check values from{" "}
              {document.low_confidence_pages.length === 1 ? "that page" : "those pages"} against the
              original.
            </p>
          ) : null}
          {!isPending(document) ? (
            <DetailsPanel
              key={[
                document.id,
                document.document_type,
                document.document_label,
                document.document_group,
                document.notes,
                ...document.tags,
              ].join("|")}
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
  verified: "Confirmed by you",
};

const METHOD_LABELS: Record<string, string> = {
  rules: "Pattern rules",
  model: "AI model",
  manual: "You",
};

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function DetailsPanel({
  document,
  onUpdated,
}: {
  document: DocumentRecord;
  onUpdated: (document: DocumentRecord) => void;
}) {
  const [options, setOptions] = useState<DocumentOptions | null>(null);
  const [typeLabel, setTypeLabel] = useState(document.document_label ?? "");
  const [group, setGroup] = useState(document.document_group ?? "");
  const [tags, setTags] = useState(document.tags.join(", "));
  const [notes, setNotes] = useState(document.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getDocumentOptions()
      .then((response) => {
        if (active) {
          setOptions(response);
        }
      })
      .catch(() => {
        // Suggestions are optional; the form works without them.
      });
    return () => {
      active = false;
    };
  }, []);

  function changeType(value: string) {
    setTypeLabel(value);
    const match = options?.types.find(
      (option) => option.label.toLowerCase() === value.trim().toLowerCase(),
    );
    if (match) {
      setGroup(match.group);
    }
  }

  const update: DocumentUpdate = {};
  if (typeLabel.trim() && typeLabel.trim() !== (document.document_label ?? "")) {
    update.document_type = typeLabel.trim();
  }
  if (group && group !== (document.document_group ?? "")) {
    update.document_group = group;
  }
  if (parseTags(tags).join("\n") !== document.tags.join("\n")) {
    update.tags = parseTags(tags);
  }
  if (notes.trim() !== (document.notes ?? "")) {
    update.notes = notes;
  }
  const changed = Object.keys(update).length > 0;

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      onUpdated(await updateDocument(document.id, update));
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error ? saveFailure.message : "Could not save these details.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="text-sm font-medium text-stone-900">Details</h3>
      <dl className="mt-3 grid gap-4 border-t border-stone-200 pt-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Document type</dt>
          <dd className="mt-1 text-sm text-stone-900">{document.document_label ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Group</dt>
          <dd className="mt-1 text-sm text-stone-900">
            {groupLabel(document.document_group) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Decided by</dt>
          <dd className="mt-1 text-sm text-stone-900">
            {METHOD_LABELS[document.classification_method ?? ""] ?? "—"}
          </dd>
          {document.classification_confidence !== null ? (
            <p className="mt-1 text-xs text-stone-500">
              Confidence {document.classification_confidence.toFixed(2)} (uncalibrated)
            </p>
          ) : null}
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Status</dt>
          <dd className="mt-1 text-sm text-stone-900">
            {STATUS_LABELS[document.classification_status ?? ""] ?? "—"}
          </dd>
        </div>
      </dl>
      {document.classification_reasoning ? (
        <p className="mt-3 text-sm text-stone-700">{document.classification_reasoning}</p>
      ) : null}
      <form
        className="mt-4 grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-stone-800">Document type</span>
          <input
            value={typeLabel}
            list="document-type-options"
            onChange={(event) => changeType(event.target.value)}
            placeholder="For example: Rent agreement"
            className="rounded-lg border border-stone-300 px-3 py-2"
          />
          <datalist id="document-type-options">
            {options?.types.map((option) => (
              <option key={option.value} value={option.label} />
            ))}
          </datalist>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-stone-800">Group</span>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2"
          >
            <option value="" disabled>
              Choose a group
            </option>
            {(options?.groups ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-stone-800">Tags</span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Separate tags with commas"
            className="rounded-lg border border-stone-300 px-3 py-2"
          />
          {options && options.tags.length > 0 ? (
            <span className="text-xs text-stone-500">In use: {options.tags.join(", ")}</span>
          ) : null}
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-stone-800">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
            className="rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={!changed || saving}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save details"}
          </button>
          {update.document_type && document.status === "ready" ? (
            <span className="text-xs text-stone-500">
              Changing the type extracts fields again.
            </span>
          ) : null}
        </div>
      </form>
      {saveError ? <p className="mt-2 text-sm text-red-700">{saveError}</p> : null}
    </section>
  );
}

const KIND_LABELS: Record<string, string> = {
  text: "Text",
  name: "Name",
  date: "Date",
  id_number: "ID number",
  amount: "Amount",
  number: "Number",
  percentage: "Percentage",
  address: "Address",
  phone: "Phone",
  email: "Email",
};

function fieldDetails(field: DocumentField) {
  return [
    field.kind ? (KIND_LABELS[field.kind] ?? field.kind) : null,
    field.date_role,
    field.normalized_value,
    field.page_number === null ? null : `Page ${field.page_number}`,
  ].filter((item): item is string => Boolean(item));
}

function pageList(pages: number[]) {
  return pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`;
}

const FIELD_LABELS: Record<string, string> = {
  fathers_name: "Father's Name",
  mothers_name: "Mother's Name",
  cgpa: "CGPA",
  pan_number: "PAN Number",
};

function fieldLabel(name: string) {
  return (
    FIELD_LABELS[name] ??
    name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
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
  const fields = payload?.fields ?? [];
  const stored = new Map(fields.map((field) => [field.field_name, field]));
  const names = payload?.expected_fields ?? [];
  // Template fields first (missing ones included), then any other labelled values.
  const rows: (DocumentField | string)[] = [
    ...names.map((name) => stored.get(name) ?? name),
    ...fields.filter((field) => !names.includes(field.field_name)),
  ];
  const updateField = (updated: DocumentField) => {
    setPayload((current) =>
      current
        ? {
            ...current,
            fields: current.fields.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-stone-900">Extracted Fields</h3>
        {status === "failed" || status === "completed" ? (
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              void retry();
            }}
            className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-800"
          >
            {retrying ? "Starting…" : status === "failed" ? "Retry extraction" : "Extract again"}
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
      {status === "completed" && rows.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">No labelled values were found.</p>
      ) : null}
      {status === "completed" && rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto border-t border-stone-200 pt-3">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3 font-medium">Field</th>
                <th className="py-2 pr-3 font-medium">Value</th>
                <th className="py-2 pr-3 font-medium">Details</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                typeof row === "string" ? (
                  <tr key={row} className="border-t border-stone-100">
                    <td className="py-2 pr-3 text-stone-800">{fieldLabel(row)}</td>
                    <td className="py-2 pr-3 text-stone-400">Missing</td>
                    <td className="py-2 pr-3 text-stone-400">—</td>
                    <td className="py-2 pr-3 text-stone-400">Not extracted</td>
                    <td className="py-2 text-stone-400">—</td>
                  </tr>
                ) : (
                  <FieldRow
                    key={row.id}
                    documentId={document.id}
                    field={row}
                    lowConfidence={
                      row.page_number !== null &&
                      document.low_confidence_pages.includes(row.page_number)
                    }
                    onUpdated={updateField}
                  />
                ),
              )}
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
  lowConfidence,
  onUpdated,
}: {
  documentId: string;
  field: DocumentField;
  lowConfidence: boolean;
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
      <td className="py-2 pr-3 text-stone-800">{field.label ?? fieldLabel(field.field_name)}</td>
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
      <td className="py-2 pr-3 text-xs text-stone-600">
        {fieldDetails(field).join(" · ") || "—"}
        {lowConfidence ? (
          <span className="mt-1 block text-amber-800">Hard-to-read page</span>
        ) : null}
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

  if (document.status === "stored") {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-700">
        <p>
          {document.error_message ||
            "This file is stored in the vault, but its contents cannot be read."}
        </p>
        <p className="mt-2 text-stone-500">
          Text is read from {READABLE_FORMATS_TEXT}. You can still set a type, tags, and notes.
        </p>
      </section>
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
