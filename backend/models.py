from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class HealthResponse(BaseModel):
    status: str


class DocumentRecord(BaseModel):
    id: str
    filename: str
    media_type: str
    stored_path: str
    page_count: Optional[int] = None
    document_type: Optional[str] = None
    document_label: Optional[str] = None
    document_group: Optional[str] = None
    classification_confidence: Optional[float] = None
    classification_status: Optional[str] = None
    classification_method: Optional[str] = None
    classification_reasoning: Optional[str] = None
    field_extraction_status: Optional[str] = None
    field_extraction_error: Optional[str] = None
    index_status: Optional[str] = None
    index_error: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    full_text: Optional[str] = None
    ocr_confidence: Optional[float] = None
    low_confidence_pages: List[int] = Field(default_factory=list)
    notes: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    created_at: str


class DocumentListResponse(BaseModel):
    documents: List[DocumentRecord]


class DocumentDeleteResponse(BaseModel):
    id: str
    deleted: bool


class DocumentUpdate(BaseModel):
    """Fields left out are not changed. An empty notes string clears the notes."""

    document_type: Optional[str] = None
    document_group: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        tags: List[str] = []
        for item in value:
            tag = " ".join(item.split())[:40]
            if tag and tag.casefold() not in {existing.casefold() for existing in tags}:
                tags.append(tag)
        if len(tags) > 20:
            raise ValueError("A document can have at most 20 tags.")
        return tags

    @field_validator("notes")
    @classmethod
    def check_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and len(value) > 2000:
            raise ValueError("Notes are too long.")
        return value


class DocumentTypeOption(BaseModel):
    value: str
    label: str
    group: str


class DocumentGroupOption(BaseModel):
    value: str
    label: str


class DocumentOptionsResponse(BaseModel):
    types: List[DocumentTypeOption]
    groups: List[DocumentGroupOption]
    tags: List[str]


class DocumentField(BaseModel):
    id: int
    document_id: str
    field_name: str
    extracted_value: str
    label: Optional[str] = None
    kind: Optional[str] = None
    date_role: Optional[str] = None
    normalized_value: Optional[str] = None
    page_number: Optional[int] = None
    verification_status: str
    source_text: Optional[str] = None


class DocumentFieldsResponse(BaseModel):
    field_extraction_status: Optional[str] = None
    field_extraction_error: Optional[str] = None
    document_type: Optional[str] = None
    expected_fields: List[str]
    fields: List[DocumentField]


class FieldValueUpdate(BaseModel):
    extracted_value: str


class ProfileField(BaseModel):
    id: int
    field_name: str
    field_value: str
    verification_status: str
    source_document_id: Optional[str] = None
    source_document_field_id: Optional[int] = None
    source_filename: Optional[str] = None
    source_available: bool
    created_at: str
    updated_at: str


class ProfileResponse(BaseModel):
    fields: List[ProfileField]


class ProfileFieldCreate(BaseModel):
    field_name: str
    field_value: str


class ProfileFieldPatch(BaseModel):
    field_value: str


class ProfileImportRequest(BaseModel):
    document_id: str
    document_field_id: int


class ImportableField(BaseModel):
    document_id: str
    document_field_id: int
    document_filename: str
    field_name: str
    source_field_name: str
    field_value: str
    proposed_value: str


class ImportableFieldsResponse(BaseModel):
    fields: List[ImportableField]


class ProfileConflict(BaseModel):
    conflict: bool = True
    field_name: str
    existing_value: str
    existing_source_filename: Optional[str] = None
    existing_source_available: bool
    proposed_value: str
    proposed_source_filename: Optional[str] = None
    proposed_document_id: Optional[str] = None
    proposed_document_field_id: Optional[int] = None


class ProfileResolveRequest(BaseModel):
    action: str
    document_id: Optional[str] = None
    document_field_id: Optional[int] = None
    field_name: Optional[str] = None
    field_value: Optional[str] = None


class SearchRequest(BaseModel):
    query: str


class SearchHit(BaseModel):
    document_id: str
    filename: str
    document_type: Optional[str] = None
    document_label: Optional[str] = None
    chunk_index: int
    page_number: Optional[int] = None
    text: str
    score: float


class SearchResponse(BaseModel):
    results: List[SearchHit]


class ChatMessage(BaseModel):
    role: str
    content: str

    @field_validator("role")
    @classmethod
    def check_role(cls, value: str) -> str:
        if value not in {"user", "assistant"}:
            raise ValueError("Message role must be user or assistant.")
        return value

    @field_validator("content")
    @classmethod
    def check_content(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Message content is required.")
        if len(cleaned) > 4000:
            raise ValueError("Message content is too long.")
        return cleaned


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = Field(default_factory=list)

    @field_validator("message")
    @classmethod
    def check_message(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Enter a question.")
        if len(cleaned) > 4000:
            raise ValueError("Question is too long.")
        return cleaned

    @field_validator("history")
    @classmethod
    def check_history(cls, value: List[ChatMessage]) -> List[ChatMessage]:
        if len(value) > 8:
            raise ValueError("Conversation history is too long.")
        return value


class ChatSource(BaseModel):
    label: str
    document_id: str
    filename: str
    page_number: Optional[int] = None
    chunk_id: int
    snippet: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    sources: List[ChatSource]
    status: str
