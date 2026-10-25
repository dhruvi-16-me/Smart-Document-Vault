import type {
  ChatMessage,
  ChatResponse,
  DocumentDeleteResponse,
  DocumentField,
  DocumentFieldsResponse,
  DocumentListResponse,
  DocumentOptions,
  DocumentRecord,
  DocumentUpdate,
  HealthResponse,
  ImportableField,
  ProfileConflict,
  ProfileField,
  ProfileResponse,
  SearchResponse,
} from "./types.ts";

export const API_BASE = "http://127.0.0.1:8765";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body.detail;
    const message =
      typeof detail === "string" && detail
        ? detail
        : `Request failed (${response.status})`;
    return new ApiError(response.status, detail, message);
  } catch {
    return new ApiError(response.status, null, `Request failed (${response.status})`);
  }
}

export function getHealth() {
  return request<HealthResponse>("/health");
}

export function listDocuments() {
  return request<DocumentListResponse>("/documents");
}

export function getDocument(id: string) {
  return request<DocumentRecord>(`/documents/${id}`);
}

export function uploadDocument(file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<DocumentRecord>("/documents", { method: "POST", body });
}

export function getDocumentOptions() {
  return request<DocumentOptions>("/documents/options");
}

export function updateDocument(id: string, update: DocumentUpdate) {
  return request<DocumentRecord>(`/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export function getDocumentFields(id: string) {
  return request<DocumentFieldsResponse>(`/documents/${id}/fields`);
}

export function updateDocumentField(id: string, fieldId: number, extractedValue: string) {
  return request<DocumentField>(`/documents/${id}/fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify({ extracted_value: extractedValue }),
  });
}

export function retryFieldExtraction(id: string) {
  return request<DocumentRecord>(`/documents/${id}/extract-fields`, {
    method: "POST",
  });
}

export function deleteDocument(id: string) {
  return request<DocumentDeleteResponse>(`/documents/${id}`, {
    method: "DELETE",
  });
}

export function getProfile() {
  return request<ProfileResponse>("/profile");
}

export function createProfileField(fieldName: string, fieldValue: string) {
  return request<ProfileField>("/profile/fields", {
    method: "POST",
    body: JSON.stringify({ field_name: fieldName, field_value: fieldValue }),
  });
}

export function updateProfileField(fieldId: number, fieldValue: string) {
  return request<ProfileField>(`/profile/fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify({ field_value: fieldValue }),
  });
}

export function deleteProfileField(fieldId: number) {
  return request<{ id: number; deleted: boolean }>(`/profile/fields/${fieldId}`, {
    method: "DELETE",
  });
}

export function getImportableFields() {
  return request<{ fields: ImportableField[] }>("/profile/importable-fields");
}

export function importProfileField(documentId: string, documentFieldId: number) {
  return request<ProfileField>("/profile/import", {
    method: "POST",
    body: JSON.stringify({ document_id: documentId, document_field_id: documentFieldId }),
  });
}

export function resolveProfileConflict(body: {
  action: "keep" | "replace";
  document_id?: string;
  document_field_id?: number;
  field_name?: string;
  field_value?: string;
}) {
  return request<ProfileField>("/profile/conflicts/resolve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function isProfileConflict(error: unknown): error is ApiError & { detail: ProfileConflict } {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    typeof error.detail === "object" &&
    error.detail !== null &&
    "conflict" in error.detail
  );
}

export function searchDocuments(query: string) {
  const params = new URLSearchParams({ q: query });
  return request<SearchResponse>(`/search?${params.toString()}`);
}

export function sendChat(message: string, history: ChatMessage[]) {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      history: history.map((item) => ({ role: item.role, content: item.content })),
    }),
  });
}
