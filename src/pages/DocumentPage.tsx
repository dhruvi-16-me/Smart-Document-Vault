import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  getDocument,
  getDocumentFields,
  getDocumentOptions,
  previewUrl,
  retryDocument,
  retryFieldExtraction,
  updateDocument,
  updateDocumentField,
} from "../api.ts";
import { BackIcon, ChatIcon, FileIcon } from "../components/icons.tsx";
import { Badge, Button, Card, GroupBadge, Notice, Skeleton, Spinner, inputClass } from "../components/ui.tsx";
import { useToast } from "../toast.ts";
import type {
  DocumentField,
  DocumentFieldsResponse,
  DocumentOptions,
  DocumentUpdate,
} from "../types.ts";
import {
  READABLE_FORMATS_TEXT,
  fileTypeLabel,
  groupColor,
  groupLabel,
  statusBadge,
  unfinishedSteps,
  type DocumentRecord,
} from "../types.ts";

type DocumentPageProps = {
  documentId: string;
  focus: { page: number; at: number } | null;
  onBack: () => void;
  onAsk: () => void;
  onLoaded: (document: DocumentRecord) => void;
};

type Tab = "fields" | "details" | "text";

// The browser shows these as they are; the API converts the rest to page images.
const NATIVE_IMAGES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CONVERTED_IMAGES = new Set(["image/heic", "image/heif", "image/tiff"]);

function isPending(document: DocumentRecord) {
  return document.status === "uploaded" || document.status === "processing";
}

function fieldsAreRunning(document: DocumentRecord) {
  return (
    document.field_extraction_status === "pending" ||
    document.field_extraction_status === "processing"
  );
}

function stepsAreRunning(document: DocumentRecord) {
  return (
    fieldsAreRunning(document) ||
    document.classification_status === "processing" ||
    document.index_status === "processing"
  );
}

export function DocumentPage({ documentId, focus, onBack, onAsk, onLoaded }: DocumentPageProps) {
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(focus?.page ?? 1);
  const [tab, setTab] = useState<Tab>("fields");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Bumped to restart polling after a retry starts.
  const [reload, setReload] = useState(0);
  const toast = useToast();

  useEffect(() => {
    if (focus) {
      setPreviewPage(focus.page);
    }
  }, [focus]);

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
        if (isPending(record) || (record.status === "ready" && stepsAreRunning(record))) {
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
  }, [documentId, reload]);

  const loadedId = document?.id;
  const loadedName = document?.filename;
  useEffect(() => {
    if (document && loadedId) {
      onLoaded(document);
    }
    // Report once per loaded document, not on every poll.
  }, [loadedId, loadedName]);

  if (error) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <Notice tone="red">{error}</Notice>
      </div>
    );
  }
  if (!document) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading document">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-80" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[60vh]" />
          <Skeleton className="h-[60vh]" />
        </div>
      </div>
    );
  }

  const status = statusBadge(document);
  const unfinished = unfinishedSteps(document);

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      setDocument(await retryDocument(documentId));
      setReload((count) => count + 1);
      toast("Trying the remaining steps again", "info");
    } catch (failure) {
      setRetryError(failure instanceof Error ? failure.message : "Could not start again.");
    } finally {
      setRetrying(false);
    }
  }
  const activeTab: Tab = document.status === "ready" ? tab : tab === "fields" ? "details" : tab;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackButton onBack={onBack} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-stone-900">
              {document.filename}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {document.document_label ? <Badge tone="brand">{document.document_label}</Badge> : null}
              {document.document_group ? (
                <GroupBadge
                  color={groupColor(document.document_group)}
                  label={groupLabel(document.document_group) ?? document.document_group}
                />
              ) : null}
              <Badge>{fileTypeLabel(document)}</Badge>
              {document.page_count ? (
                <Badge>
                  {document.page_count} page{document.page_count === 1 ? "" : "s"}
                </Badge>
              ) : null}
              {status ? (
                <Badge tone={status.tone} status>
                  {status.label}
                </Badge>
              ) : null}
              {document.tags.map((tag) => (
                <Badge key={tag} tone="blue">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          <Button variant="primary" onClick={onAsk}>
            <ChatIcon size={18} /> Ask about this document
          </Button>
        </div>
      </div>

      {isPending(document) ? (
        <Notice tone="brand">
          <Spinner label="Reading this document. Text, type, and fields will appear in a moment." />
        </Notice>
      ) : null}
      {document.status === "failed" ? (
        <Notice tone="red">{document.error_message || "Could not read text from this document."}</Notice>
      ) : null}
      {document.status === "stored" ? (
        <Notice tone="amber">
          {document.error_message || "This file is stored in the vault, but its contents cannot be read."}{" "}
          Text is read from {READABLE_FORMATS_TEXT}. You can still set a type, tags, and notes.
        </Notice>
      ) : null}
      {unfinished.length > 0 ? (
        <Notice tone="amber">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              The text was read, but last time the app could not {joinSteps(unfinished)}
              {document.index_error
                ? ` because of this error: "${document.index_error.replace(/\.$/, "")}"`
                : ""}
              . If Ollama is running now, click Try again.
            </p>
            <Button size="sm" variant="primary" disabled={retrying} onClick={() => void retry()}>
              {retrying ? "Starting…" : "Try again"}
            </Button>
          </div>
          {retryError ? <p className="mt-2 text-red-700">{retryError}</p> : null}
        </Notice>
      ) : null}
      {document.status === "ready" && stepsAreRunning(document) && !fieldsAreRunning(document) ? (
        <Notice tone="brand">
          <Spinner label="Finishing the remaining steps…" />
        </Notice>
      ) : null}
      {document.low_confidence_pages.length > 0 ? (
        <Notice tone="amber">
          Text was hard to read on {pageList(document.low_confidence_pages)}. Check values from{" "}
          {document.low_confidence_pages.length === 1 ? "that page" : "those pages"} against the
          original.
        </Notice>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="lg:sticky lg:top-0">
          <Preview document={document} page={previewPage} onPageChange={setPreviewPage} />
        </div>
        <Card className="p-0">
          <div className="flex gap-1 border-b border-stone-200 px-3 pt-3" role="tablist">
            {document.status === "ready" ? (
              <TabButton active={activeTab === "fields"} onClick={() => setTab("fields")}>
                Fields
              </TabButton>
            ) : null}
            <TabButton active={activeTab === "details"} onClick={() => setTab("details")}>
              Details
            </TabButton>
            {document.full_text ? (
              <TabButton active={activeTab === "text"} onClick={() => setTab("text")}>
                Text
              </TabButton>
            ) : null}
          </div>
          <div className="p-5">
            {activeTab === "fields" ? (
              <ExtractedFields
                key={`${document.id}-${document.field_extraction_status}-${document.document_type}`}
                document={document}
                onDocumentUpdated={setDocument}
                onShowPage={setPreviewPage}
              />
            ) : null}
            {activeTab === "details" && !isPending(document) ? (
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
            {activeTab === "text" ? (
              <pre className="max-h-[70vh] overflow-y-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-stone-700">
                {document.full_text}
              </pre>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function joinSteps(steps: string[]) {
  return steps.length <= 1 ? steps.join("") : `${steps.slice(0, -1).join(", ")} or ${steps[steps.length - 1]}`;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1 text-sm font-medium text-stone-600 hover:text-brand-700"
    >
      <BackIcon size={16} /> Vault
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "border-brand-600 text-brand-700"
          : "border-transparent text-stone-600 hover:text-stone-800"
      }`}
    >
      {children}
    </button>
  );
}

function Preview({
  document,
  page,
  onPageChange,
}: {
  document: DocumentRecord;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const pages = document.page_count ?? 1;
  const frame = "overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 shadow-sm";

  if (document.media_type === "application/pdf" && !failed) {
    return (
      <iframe
        // A new key reloads the viewer, which is how it jumps to a page.
        key={page}
        title={`Preview of ${document.filename}`}
        src={`${previewUrl(document.id)}#page=${page}&view=FitH`}
        className={`${frame} h-[78vh] w-full`}
      />
    );
  }

  const native = NATIVE_IMAGES.has(document.media_type);
  const converted = CONVERTED_IMAGES.has(document.media_type);
  if ((native || converted) && !failed) {
    const shown = converted ? Math.min(page, pages) : 1;
    return (
      <div className={frame}>
        <img
          src={previewUrl(document.id, shown)}
          alt={`Page ${shown} of ${document.filename}`}
          onError={() => setFailed(true)}
          className="max-h-[72vh] w-full bg-white object-contain"
        />
        {converted && pages > 1 ? (
          <div className="flex items-center justify-between border-t border-stone-200 bg-white px-3 py-2 text-sm">
            <Button size="sm" variant="ghost" disabled={shown <= 1} onClick={() => onPageChange(shown - 1)}>
              Previous
            </Button>
            <span className="text-stone-600">
              Page {shown} of {pages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={shown >= pages}
              onClick={() => onPageChange(shown + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${frame} flex min-h-80 flex-col items-center justify-center bg-white p-8 text-center`}>
      <FileIcon size={40} className="text-stone-300" />
      <p className="mt-3 font-medium text-stone-700">No picture preview for this file</p>
      <p className="mt-1 text-sm text-stone-600">
        {document.full_text ? "Its text is in the Text tab." : "It is kept in the vault as it is."}
      </p>
    </div>
  );
}

const CLASSIFICATION_STATUS: Record<string, string> = {
  processing: "Identifying…",
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
  const toast = useToast();

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
      toast("Details saved");
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error ? saveFailure.message : "Could not save these details.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <Fact label="Identified by">
          {METHOD_LABELS[document.classification_method ?? ""] ?? "—"}
          {document.classification_confidence !== null ? (
            <span className="block text-xs text-stone-600">
              Confidence {Math.round(document.classification_confidence * 100)}% (estimate)
            </span>
          ) : null}
        </Fact>
        <Fact label="Status">{CLASSIFICATION_STATUS[document.classification_status ?? ""] ?? "—"}</Fact>
        <Fact label="OCR confidence">
          {document.ocr_confidence === null ? "Not scanned" : `${Math.round(document.ocr_confidence)}%`}
        </Fact>
        <Fact label="Added">{new Date(`${document.created_at.replace(" ", "T")}Z`).toLocaleDateString()}</Fact>
      </dl>
      {document.classification_reasoning ? (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
          {document.classification_reasoning}
        </p>
      ) : null}
      <form
        className="grid gap-4 border-t border-stone-200 pt-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-stone-700">Document type</span>
          <input
            value={typeLabel}
            list="document-type-options"
            onChange={(event) => changeType(event.target.value)}
            placeholder="For example: Rent agreement"
            className={inputClass}
          />
          <datalist id="document-type-options">
            {options?.types.map((option) => (
              <option key={option.value} value={option.label} />
            ))}
          </datalist>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-stone-700">Group</span>
          <select value={group} onChange={(event) => setGroup(event.target.value)} className={inputClass}>
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
        <label className="grid gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium text-stone-700">Tags</span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Separate tags with commas"
            className={inputClass}
          />
          {options && options.tags.length > 0 ? (
            <span className="text-xs text-stone-600">In use: {options.tags.join(", ")}</span>
          ) : null}
        </label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium text-stone-700">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
            className={inputClass}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={!changed || saving}>
            {saving ? "Saving…" : "Save details"}
          </Button>
          {update.document_type && document.status === "ready" ? (
            <span className="text-xs text-stone-600">Changing the type reads the fields again.</span>
          ) : null}
        </div>
      </form>
      {saveError ? <p className="text-sm text-red-700">{saveError}</p> : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-stone-600 uppercase">{label}</dt>
      <dd className="mt-1 text-stone-900">{children}</dd>
    </div>
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
  ].filter((item): item is string => Boolean(item));
}

function pageList(pages: number[]) {
  return pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`;
}

const FIELD_LABELS: Record<string, string> = {
  fathers_name: "Father's name",
  mothers_name: "Mother's name",
  cgpa: "CGPA",
  pan_number: "PAN number",
};

function fieldLabel(name: string) {
  const words = name.replaceAll("_", " ");
  return FIELD_LABELS[name] ?? words.charAt(0).toUpperCase() + words.slice(1);
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
  onShowPage,
}: {
  document: DocumentRecord;
  onDocumentUpdated: (document: DocumentRecord) => void;
  onShowPage: (page: number) => void;
}) {
  const [payload, setPayload] = useState<DocumentFieldsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const toast = useToast();

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
      toast("Reading the fields again", "info");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not retry field extraction.");
    } finally {
      setRetrying(false);
    }
  }

  const status = document.field_extraction_status;
  const fields = payload?.fields ?? [];
  const names = payload?.expected_fields ?? [];
  const found = new Set(fields.map((field) => field.field_name));
  // Template fields first, in template order, then any other labelled values.
  const ordered = [
    ...names.flatMap((name) => fields.filter((field) => field.field_name === name)),
    ...fields.filter((field) => !names.includes(field.field_name)),
  ];
  const missing = names.filter((name) => !found.has(name));
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
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-600">
          {status === "completed"
            ? `${ordered.length} value${ordered.length === 1 ? "" : "s"} found. Check each one against the document, then verify it.`
            : "Values read from this document."}
        </p>
        {status === "failed" || status === "completed" ? (
          <Button size="sm" disabled={retrying} onClick={() => void retry()}>
            {retrying ? "Starting…" : status === "failed" ? "Try again" : "Read again"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {fieldsAreRunning(document) ? (
        <div className="mt-4">
          <Spinner label="Reading fields…" />
        </div>
      ) : null}
      {status === "needs_review" ? (
        <p className="mt-4 text-sm text-stone-600">
          {document.document_type
            ? "There is not enough text to read fields."
            : "Set the document type in Details before fields can be read."}
        </p>
      ) : null}
      {status === "failed" ? (
        <div className="mt-4">
          <Notice tone="red">{document.field_extraction_error || "Field extraction failed."}</Notice>
        </div>
      ) : null}
      {status === "completed" && ordered.length === 0 ? (
        <p className="mt-4 text-sm text-stone-600">No labelled values were found.</p>
      ) : null}
      {status === "completed" && ordered.length > 0 ? (
        <ul className="mt-2 divide-y divide-stone-100">
          {ordered.map((field) => (
            <FieldRow
              key={field.id}
              documentId={document.id}
              field={field}
              lowConfidence={
                field.page_number !== null && document.low_confidence_pages.includes(field.page_number)
              }
              onShowPage={onShowPage}
              onUpdated={updateField}
            />
          ))}
        </ul>
      ) : null}
      {status === "completed" && missing.length > 0 ? (
        <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
          Not found in this document: {missing.map(fieldLabel).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function FieldRow({
  documentId,
  field,
  lowConfidence,
  onShowPage,
  onUpdated,
}: {
  documentId: string;
  field: DocumentField;
  lowConfidence: boolean;
  onShowPage: (page: number) => void;
  onUpdated: (field: DocumentField) => void;
}) {
  const original = displayValue(field.extracted_value);
  const [value, setValue] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = field.verification_status === "verified";
  const edited = value !== original;
  const toast = useToast();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await updateDocumentField(documentId, field.id, value));
      toast(edited ? "Saved and verified" : "Verified");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this field.");
    } finally {
      setSaving(false);
    }
  }

  const details = fieldDetails(field);
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-stone-900">{field.label ?? fieldLabel(field.field_name)}</p>
          {details.length > 0 ? <p className="text-xs text-stone-600">{details.join(" · ")}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {lowConfidence ? <Badge tone="amber">Hard-to-read page</Badge> : null}
          {verified ? <Badge tone="green">Verified</Badge> : <Badge>AI read</Badge>}
          {field.page_number !== null ? (
            <button
              type="button"
              onClick={() => onShowPage(field.page_number as number)}
              className="rounded-full px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
              title="Show this page"
            >
              Page {field.page_number}
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor={`field-${field.id}`}>
          {field.label ?? fieldLabel(field.field_name)}
        </label>
        <input
          id={`field-${field.id}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={inputClass}
        />
        <Button
          size="sm"
          variant={verified && !edited ? "secondary" : "primary"}
          disabled={saving || (verified && !edited)}
          onClick={() => void save()}
          className="shrink-0"
        >
          {saving ? "Saving…" : edited ? "Save" : verified ? "Verified" : "Verify"}
        </Button>
      </div>
      {field.source_text ? (
        <p className="mt-2 border-l-2 border-stone-200 pl-3 text-xs text-stone-600 italic">
          “{field.source_text}”
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </li>
  );
}
