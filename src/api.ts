import type {
  ChatMessage,
  DashboardResponse,
  ChatSource,
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

export function getDashboard() {
  return request<DashboardResponse>("/dashboard");
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

/** Run again whichever of identification, field reading, and indexing did not finish. */
export function retryDocument(id: string) {
  return request<DocumentRecord>(`/documents/${id}/retry`, { method: "POST" });
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

export function previewUrl(id: string, page = 1) {
  return `${API_BASE}/documents/${id}/preview?page=${page}`;
}

export function thumbnailUrl(id: string) {
  return `${API_BASE}/documents/${id}/thumbnail`;
}

// The API accepts at most this many earlier messages.
const CHAT_HISTORY_LIMIT = 8;

export type ChatStreamHandlers = {
  onSources: (sources: ChatSource[]) => void;
  onToken: (text: string) => void;
  onDone: (answer: string, status: string) => void;
};

/** Send a question and read the newline-delimited JSON answer as it is written. */
export async function streamChat(
  message: string,
  history: ChatMessage[],
  documentId: string | null,
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
) {
  const response = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      document_id: documentId,
      history: history
        .slice(-CHAT_HISTORY_LIMIT)
        .map((item) => ({ role: item.role, content: item.content })),
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw await readError(response);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line) as
        | { type: "sources"; sources: ChatSource[] }
        | { type: "token"; text: string }
        | { type: "done"; answer: string; status: string }
        | { type: "error"; message: string };
      if (event.type === "sources") handlers.onSources(event.sources);
      else if (event.type === "token") handlers.onToken(event.text);
      else if (event.type === "done") handlers.onDone(event.answer, event.status);
      else throw new Error(event.message);
    }
    if (done) {
      return;
    }
  }
}
