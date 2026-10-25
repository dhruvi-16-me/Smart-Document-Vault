export const DOCUMENT_TYPES = [
  ["aadhaar", "Aadhaar"],
  ["pan", "PAN"],
  ["marksheet_10", "Class 10 marksheet"],
  ["marksheet_12", "Class 12 marksheet"],
  ["degree_certificate", "Degree certificate"],
  ["passport", "Passport"],
  ["drivers_license", "Driver's license"],
  ["medical", "Medical"],
  ["insurance", "Insurance"],
  ["resume", "Resume"],
  ["other", "Other"],
] as const;

export function documentTypeLabel(value: string | null) {
  const match = DOCUMENT_TYPES.find(([key]) => key === value);
  return match ? match[1] : null;
}

export type DocumentRecord = {
  id: string;
  filename: string;
  media_type: string;
  stored_path: string;
  page_count: number | null;
  document_type: string | null;
  classification_confidence: number | null;
  classification_status: string | null;
  classification_reasoning: string | null;
  field_extraction_status: string | null;
  field_extraction_error: string | null;
  index_status: string | null;
  index_error: string | null;
  status: string;
  error_message: string | null;
  full_text: string | null;
  created_at: string;
};

export type DocumentListResponse = {
  documents: DocumentRecord[];
};

export type DocumentField = {
  id: number;
  document_id: string;
  field_name: string;
  extracted_value: string;
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
