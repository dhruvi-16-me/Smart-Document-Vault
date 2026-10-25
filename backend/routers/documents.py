import json
import sqlite3
import uuid
from typing import Dict, List

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from database import connect
from models import (
    DocumentDeleteResponse,
    DocumentField,
    DocumentFieldsResponse,
    DocumentGroupOption,
    DocumentListResponse,
    DocumentOptionsResponse,
    DocumentRecord,
    DocumentTypeOption,
    DocumentUpdate,
    FieldValueUpdate,
)
from services.document_types import DOCUMENT_GROUPS, KNOWN_TYPES, normalize_group, resolve_type
from services.fields import FIELD_SCHEMAS
from services.pipeline import can_extract, process_document, run_field_extraction
from services.profile import unambiguous_iso_date
from services.storage import (
    delete_stored_file,
    is_readable,
    safe_original_name,
    save_upload,
)

router = APIRouter(prefix="/documents", tags=["documents"])


def document_from_row(row: sqlite3.Row, tags: List[str]) -> DocumentRecord:
    return DocumentRecord(
        id=row["id"],
        filename=row["filename"],
        media_type=row["media_type"],
        stored_path=row["stored_path"],
        page_count=row["page_count"],
        document_type=row["document_type"],
        document_label=row["document_label"],
        document_group=row["document_group"],
        classification_confidence=row["classification_confidence"],
        classification_status=row["classification_status"],
        classification_method=row["classification_method"],
        classification_reasoning=row["classification_reasoning"],
        field_extraction_status=row["field_extraction_status"],
        field_extraction_error=row["field_extraction_error"],
        index_status=row["index_status"],
        index_error=row["index_error"],
        status=row["status"],
        error_message=row["error_message"],
        full_text=row["full_text"],
        ocr_confidence=row["ocr_confidence"],
        low_confidence_pages=json.loads(row["low_confidence_pages"] or "[]"),
        notes=row["notes"],
        tags=tags,
        created_at=row["created_at"],
    )


def field_from_row(row: sqlite3.Row) -> DocumentField:
    return DocumentField(
        id=row["id"],
        document_id=row["document_id"],
        field_name=row["name"],
        extracted_value=row["value"],
        label=row["label"],
        kind=row["kind"],
        date_role=row["date_role"],
        normalized_value=row["normalized_value"],
        page_number=row["page_number"],
        verification_status=row["verification_status"] or "extracted",
        source_text=row["source_text"],
    )


def fetch_document(connection: sqlite3.Connection, document_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM documents WHERE id = ?",
        (document_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return row


def load_record(connection: sqlite3.Connection, document_id: str) -> DocumentRecord:
    row = fetch_document(connection, document_id)
    tags = connection.execute(
        "SELECT tag FROM document_tags WHERE document_id = ? ORDER BY tag COLLATE NOCASE",
        (document_id,),
    ).fetchall()
    return document_from_row(row, [tag["tag"] for tag in tags])


def _tags_by_document(connection: sqlite3.Connection) -> Dict[str, List[str]]:
    tags: Dict[str, List[str]] = {}
    for row in connection.execute(
        "SELECT document_id, tag FROM document_tags ORDER BY tag COLLATE NOCASE"
    ).fetchall():
        tags.setdefault(row["document_id"], []).append(row["tag"])
    return tags


@router.get("", response_model=DocumentListResponse)
def list_documents() -> DocumentListResponse:
    connection = connect()
    try:
        rows = connection.execute(
            "SELECT * FROM documents ORDER BY created_at DESC"
        ).fetchall()
        tags = _tags_by_document(connection)
        return DocumentListResponse(
            documents=[document_from_row(row, tags.get(row["id"], [])) for row in rows]
        )
    finally:
        connection.close()


@router.get("/options", response_model=DocumentOptionsResponse)
def list_document_options() -> DocumentOptionsResponse:
    """Known types, custom types already used in the vault, groups, and tags in use."""
    connection = connect()
    try:
        # With MAX(created_at), SQLite takes the other columns from the newest row,
        # so each type shows the label and group it was given most recently.
        custom = connection.execute(
            """
            SELECT document_type, document_label AS label, document_group AS grp,
                   MAX(created_at)
            FROM documents
            WHERE document_type IS NOT NULL AND document_label IS NOT NULL
            GROUP BY document_type
            ORDER BY label COLLATE NOCASE
            """
        ).fetchall()
        tags = connection.execute(
            "SELECT DISTINCT tag FROM document_tags ORDER BY tag COLLATE NOCASE"
        ).fetchall()
    finally:
        connection.close()

    types = [
        DocumentTypeOption(value=key, label=label, group=group)
        for key, (label, group) in KNOWN_TYPES.items()
    ]
    types.extend(
        DocumentTypeOption(value=row["document_type"], label=row["label"], group=row["grp"] or "other")
        for row in custom
        if row["document_type"] not in KNOWN_TYPES
    )
    return DocumentOptionsResponse(
        types=types,
        groups=[DocumentGroupOption(value=key, label=label) for key, label in DOCUMENT_GROUPS.items()],
        tags=[row["tag"] for row in tags],
    )


@router.get("/{document_id}", response_model=DocumentRecord)
def get_document(document_id: str) -> DocumentRecord:
    connection = connect()
    try:
        return load_record(connection, document_id)
    finally:
        connection.close()


@router.post("", response_model=DocumentRecord, status_code=201)
async def create_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> DocumentRecord:
    """Store any file. Readable formats are processed; other files are kept as they are."""
    try:
        try:
            filename = safe_original_name(file.filename or "")
            document_id = str(uuid.uuid4())
            upload = save_upload(document_id, filename, file.file)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
    finally:
        await file.close()

    readable = is_readable(upload.media_type)
    connection = connect()
    try:
        try:
            with connection:
                connection.execute(
                    """
                    INSERT INTO documents (
                        id, filename, media_type, stored_path, status, error_message,
                        field_extraction_status, index_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        filename,
                        upload.media_type,
                        upload.stored_path,
                        "uploaded" if readable else "stored",
                        upload.note,
                        "pending" if readable else "skipped",
                        None if readable else "skipped",
                    ),
                )
                record = load_record(connection, document_id)
        except Exception:
            delete_stored_file(upload.stored_path)
            raise
    finally:
        connection.close()

    if readable:
        background_tasks.add_task(process_document, document_id)
    return record


@router.patch("/{document_id}", response_model=DocumentRecord)
def update_document(
    document_id: str,
    body: DocumentUpdate,
    background_tasks: BackgroundTasks,
) -> DocumentRecord:
    """Change the type, group, tags, or notes. A new type re-runs field extraction."""
    group = None
    if body.document_group is not None:
        group = normalize_group(body.document_group)
        if group is None:
            raise HTTPException(status_code=400, detail="Unknown document group.")

    connection = connect()
    try:
        row = fetch_document(connection, document_id)
        extract = False
        with connection:
            if body.document_type is not None:
                try:
                    document_type, label, resolved_group = resolve_type(body.document_type, group)
                except ValueError as error:
                    raise HTTPException(status_code=400, detail=str(error)) from error
                changed = document_type != row["document_type"]
                extract = (
                    row["status"] == "ready"
                    and can_extract(document_type, row["full_text"] or "")
                    and (changed or row["field_extraction_status"] != "completed")
                )
                field_status = row["field_extraction_status"]
                if extract:
                    field_status = "processing"
                elif row["status"] == "ready" and changed:
                    field_status = "needs_review"
                connection.execute(
                    """
                    UPDATE documents
                    SET document_type = ?, document_label = ?, document_group = ?,
                        classification_confidence = NULL,
                        classification_status = 'verified',
                        classification_method = 'manual',
                        classification_reasoning = 'Set manually.',
                        field_extraction_status = ?, field_extraction_error = NULL
                    WHERE id = ?
                    """,
                    (document_type, label, resolved_group, field_status, document_id),
                )
            elif group is not None:
                connection.execute(
                    "UPDATE documents SET document_group = ? WHERE id = ?",
                    (group, document_id),
                )
            if body.notes is not None:
                connection.execute(
                    "UPDATE documents SET notes = ? WHERE id = ?",
                    (body.notes.strip() or None, document_id),
                )
            if body.tags is not None:
                connection.execute(
                    "DELETE FROM document_tags WHERE document_id = ?", (document_id,)
                )
                connection.executemany(
                    "INSERT INTO document_tags (document_id, tag) VALUES (?, ?)",
                    [(document_id, tag) for tag in body.tags],
                )
        updated = load_record(connection, document_id)
    finally:
        connection.close()

    if extract:
        background_tasks.add_task(run_field_extraction, document_id)
    return updated


@router.get("/{document_id}/fields", response_model=DocumentFieldsResponse)
def list_document_fields(document_id: str) -> DocumentFieldsResponse:
    connection = connect()
    try:
        document = fetch_document(connection, document_id)
        rows = connection.execute(
            "SELECT * FROM document_fields WHERE document_id = ? ORDER BY id",
            (document_id,),
        ).fetchall()
        document_type = document["document_type"]
        expected = list(FIELD_SCHEMAS.get(document_type, {}))
        return DocumentFieldsResponse(
            field_extraction_status=document["field_extraction_status"],
            field_extraction_error=document["field_extraction_error"],
            document_type=document_type,
            expected_fields=expected,
            fields=[field_from_row(row) for row in rows],
        )
    finally:
        connection.close()


@router.patch("/{document_id}/fields/{field_id}", response_model=DocumentField)
def update_document_field(
    document_id: str, field_id: int, body: FieldValueUpdate
) -> DocumentField:
    value = " ".join(body.extracted_value.split())
    if not value:
        raise HTTPException(status_code=400, detail="Field value is required.")

    connection = connect()
    try:
        fetch_document(connection, document_id)
        row = connection.execute(
            "SELECT * FROM document_fields WHERE id = ? AND document_id = ?",
            (field_id, document_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Field not found.")
        value = value[:2000]
        normalized = unambiguous_iso_date(value, day_first=True) if row["kind"] == "date" else None
        with connection:
            connection.execute(
                """
                UPDATE document_fields
                SET value = ?, normalized_value = ?, verification_status = 'verified'
                WHERE id = ? AND document_id = ?
                """,
                (value, normalized, field_id, document_id),
            )
        updated = connection.execute(
            "SELECT * FROM document_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        return field_from_row(updated)
    finally:
        connection.close()


@router.post("/{document_id}/extract-fields", response_model=DocumentRecord)
def retry_field_extraction(
    document_id: str, background_tasks: BackgroundTasks
) -> DocumentRecord:
    connection = connect()
    try:
        row = fetch_document(connection, document_id)
        if row["status"] != "ready":
            raise HTTPException(status_code=400, detail="Document text is not ready.")
        if row["field_extraction_status"] == "processing":
            raise HTTPException(status_code=409, detail="Field extraction is already running.")
        if not row["document_type"]:
            raise HTTPException(
                status_code=400,
                detail="Confirm a document type before extracting fields.",
            )
        if not can_extract(row["document_type"], row["full_text"] or ""):
            raise HTTPException(
                status_code=400,
                detail="Not enough extracted text to find fields.",
            )
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET field_extraction_status = 'processing', field_extraction_error = NULL
                WHERE id = ?
                """,
                (document_id,),
            )
            record = load_record(connection, document_id)
    finally:
        connection.close()

    background_tasks.add_task(run_field_extraction, document_id)
    return record


@router.post("/{document_id}/index", response_model=DocumentRecord)
def reindex_document(document_id: str, background_tasks: BackgroundTasks) -> DocumentRecord:
    connection = connect()
    try:
        row = fetch_document(connection, document_id)
        if row["status"] != "ready":
            raise HTTPException(status_code=400, detail="Document text is not ready.")
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET index_status = 'processing', index_error = NULL
                WHERE id = ?
                """,
                (document_id,),
            )
            record = load_record(connection, document_id)
    finally:
        connection.close()
    from services.index import index_document

    background_tasks.add_task(index_document, document_id)
    return record


@router.delete("/{document_id}", response_model=DocumentDeleteResponse)
def delete_document(document_id: str) -> DocumentDeleteResponse:
    connection = connect()
    try:
        row = fetch_document(connection, document_id)
        stored_path = row["stored_path"]
        from services.index import remove_document_vectors

        remove_document_vectors(document_id)
        with connection:
            connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    finally:
        connection.close()

    delete_stored_file(stored_path)
    return DocumentDeleteResponse(id=document_id, deleted=True)
