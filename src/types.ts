const FILE_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WEBP",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
  "image/tiff": "TIFF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
};

export function fileTypeLabel(document: Pick<DocumentRecord, "media_type" | "filename">) {
  const known = FILE_TYPE_LABELS[document.media_type];
  if (known) {
    return known;
  }
  const extension = document.filename.includes(".")
    ? document.filename.split(".").pop()?.toUpperCase()
    : null;
  return extension || "File";
}

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  failed: "Could not read",
  stored: "Stored only",
};

export function groupLabel(group: string | null) {
  return group ? group.charAt(0).toUpperCase() + group.slice(1) : null;
}

export const READABLE_FORMATS_TEXT =
  "PDF, images (PNG, JPG, WEBP, HEIC, TIFF), Word (.docx), and text files (.txt, .md, .csv)";

export type DocumentRecord = {
  id: string;
  filename: string;
  media_type: string;
  stored_path: string;
  page_count: number | null;
  document_type: string | null;
  document_label: string | null;
  document_group: string | null;
  classification_confidence: number | null;
  classification_status: string | null;
  classification_method: string | null;
  classification_reasoning: string | null;
  field_extraction_status: string | null;
  field_extraction_error: string | null;
  index_status: string | null;
  index_error: string | null;
  status: string;
  error_message: string | null;
  full_text: string | null;
  ocr_confidence: number | null;
  low_confidence_pages: number[];
  notes: string | null;
  tags: string[];
  created_at: string;
};

export type DocumentUpdate = {
  document_type?: string;
  document_group?: string;
  tags?: string[];
  notes?: string;
};

export type DocumentOptions = {
  types: { value: string; label: string; group: string }[];
  groups: { value: string; label: string }[];
  tags: string[];
};

export type DocumentListResponse = {
  documents: DocumentRecord[];
};

export type DocumentField = {
  id: number;
  document_id: string;
  field_name: string;
  extracted_value: string;
  label: string | null;
  kind: string | null;
  date_role: string | null;
  normalized_value: string | null;
  page_number: number | null;
  verification_status: string;
  source_text: string | null;
};

export type DocumentFieldsResponse = {
  field_extraction_status: string | null;
  field_extraction_error: string | null;
  document_type: string | null;
  expected_fields: string[];
  fields: DocumentField[];
};

export type DocumentDeleteResponse = {
  id: string;
  deleted: boolean;
};

export type ProfileField = {
  id: number;
  field_name: string;
  field_value: string;
  verification_status: string;
  source_document_id: string | null;
  source_document_field_id: number | null;
  source_filename: string | null;
  source_available: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileResponse = {
  fields: ProfileField[];
};

export type ImportableField = {
  document_id: string;
  document_field_id: number;
  document_filename: string;
  field_name: string;
  source_field_name: string;
  field_value: string;
  proposed_value: string;
};

export type ProfileConflict = {
  conflict: true;
  field_name: string;
  existing_value: string;
  existing_source_filename: string | null;
  existing_source_available: boolean;
  proposed_value: string;
  proposed_source_filename: string | null;
  proposed_document_id: string | null;
  proposed_document_field_id: number | null;
};

export type SearchHit = {
  document_id: string;
  filename: string;
  document_type: string | null;
  document_label: string | null;
  chunk_index: number;
  page_number: number | null;
  text: string;
  score: number;
};

export type SearchResponse = {
  results: SearchHit[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  status?: string;
};

export type ChatSource = {
  label: string;
  document_id: string;
  filename: string;
  page_number: number | null;
  chunk_id: number;
  snippet: string;
  score: number;
};

export type ChatResponse = {
  answer: string;
  sources: ChatSource[];
  status: string;
};

export type HealthResponse = {
  status: string;
};
