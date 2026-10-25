import re
import sqlite3
import uuid

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from database import connect
from models import (
    DocumentDeleteResponse,
    DocumentField,
    DocumentFieldsResponse,
    DocumentListResponse,
    DocumentRecord,
    DocumentTypeUpdate,
    FieldValueUpdate,
)
from services.classify import DOCUMENT_TYPES, classify_document
from services.fields import FIELD_SCHEMAS, extract_fields
from services.extract import extract_pdf_text
from services.ocr import ocr_image, ocr_pdf
from services.storage import (
    delete_stored_file,
    extension_for,
    media_type_for,
    resolve_stored_path,
    safe_original_name,
    save_upload,
)

router = APIRouter(prefix="/documents", tags=["documents"])


def document_from_row(row: sqlite3.Row) -> DocumentRecord:
    return DocumentRecord(
        id=row["id"],
        filename=row["filename"],
        media_type=row["media_type"],
        stored_path=row["stored_path"],
        page_count=row["page_count"],
        document_type=row["document_type"],
        classification_confidence=row["classification_confidence"],
        classification_status=row["classification_status"],
        classification_reasoning=row["classification_reasoning"],
        field_extraction_status=row["field_extraction_status"],
        field_extraction_error=row["field_extraction_error"],
        index_status=row["index_status"],
        index_error=row["index_error"],
        status=row["status"],
        error_message=row["error_message"],
        full_text=row["full_text"],
        created_at=row["created_at"],
    )


def fetch_document(connection: sqlite3.Connection, document_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM documents WHERE id = ?",
        (document_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return row


@router.get("", response_model=DocumentListResponse)
def list_documents() -> DocumentListResponse:
    connection = connect()
    try:
        rows = connection.execute(
            "SELECT * FROM documents ORDER BY created_at DESC"
        ).fetchall()
        return DocumentListResponse(documents=[document_from_row(row) for row in rows])
    finally:
        connection.close()


@router.get("/{document_id}", response_model=DocumentRecord)
def get_document(document_id: str) -> DocumentRecord:
    connection = connect()
    try:
        return document_from_row(fetch_document(connection, document_id))
    finally:
        connection.close()


def process_pdf_document(document_id: str) -> None:
    """Extract selectable PDF text, then OCR the file when that text is sparse."""
    stored_path = _mark_processing(document_id, "application/pdf")
    if stored_path is None:
        return

    try:
        file_path = str(resolve_stored_path(stored_path))
        result = extract_pdf_text(file_path)
        if _text_is_sparse(str(result["text"]), int(result["page_count"])):
            result = ocr_pdf(file_path)
    except Exception as error:
        _mark_failed(document_id, error, "Could not extract text from this PDF.")
        return

    _finish_document(document_id, str(result["text"]), int(result["page_count"]))


def process_image_document(document_id: str) -> None:
    """OCR an uploaded image. Images are single pages and have no PDF page markers."""
    stored_path = _mark_processing(document_id, None)
    if stored_path is None:
        return

    try:
        text = ocr_image(str(resolve_stored_path(stored_path)))
    except Exception as error:
        _mark_failed(document_id, error, "Could not read text from this image.")
        return

    _finish_document(document_id, text, 1)


def _mark_processing(document_id: str, media_type):
    connection = connect()
    try:
        row = connection.execute(
            "SELECT media_type, stored_path FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if row is None:
            return None
        if media_type is not None and row["media_type"] != media_type:
            return None
        if media_type is None and not str(row["media_type"]).startswith("image/"):
            return None
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET status = 'processing', error_message = NULL
                WHERE id = ?
                """,
                (document_id,),
            )
        return row["stored_path"]
    finally:
        connection.close()


def _finish_document(document_id: str, text: str, page_count: int) -> None:
    try:
        classification = classify_document(text)
    except Exception as error:
        message = " ".join(str(error).split()) or "Could not classify this document."
        if "/" in message or "\\" in message:
            message = "Could not classify this document."
        classification_type = None
        confidence = None
        classification_status = "failed"
        reasoning = message[:500]
    else:
        classification_type = classification.document_type
        confidence = classification.confidence
        classification_status = classification.status
        reasoning = classification.reasoning

    connection = connect()
    try:
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET full_text = ?, page_count = ?, status = 'ready', error_message = NULL,
                    document_type = ?, classification_confidence = ?,
                    classification_status = ?, classification_reasoning = ?,
                    field_extraction_status = ?, field_extraction_error = NULL
                WHERE id = ?
                """,
                (
                    text,
                    page_count,
                    classification_type,
                    confidence,
                    classification_status,
                    reasoning,
                    "processing" if _can_extract(classification_type, text) else "needs_review",
                    document_id,
                ),
            )
    finally:
        connection.close()

    if _can_extract(classification_type, text):
        run_field_extraction(document_id)
    try:
        from services.index import _mark_index_failed, index_document

        index_document(document_id)
    except Exception:
        _mark_index_failed(document_id, "Could not index this document.")


def _can_extract(document_type, text: str) -> bool:
    if document_type not in FIELD_SCHEMAS:
        return False
    body = re.sub(r"\[Page \d+\]", "", text or "")
    return len("".join(body.split())) >= 40


def run_field_extraction(document_id: str) -> None:
    connection = connect()
    try:
        row = connection.execute(
            "SELECT status, document_type, full_text FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if row is None or row["status"] != "ready":
            return
        document_type = row["document_type"]
        text = row["full_text"] or ""
        if not _can_extract(document_type, text):
            with connection:
                connection.execute(
                    """
                    UPDATE documents
                    SET field_extraction_status = 'needs_review',
                        field_extraction_error = NULL
                    WHERE id = ?
                    """,
                    (document_id,),
                )
            return
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET field_extraction_status = 'processing', field_extraction_error = NULL
                WHERE id = ?
                """,
                (document_id,),
            )
    finally:
        connection.close()

    try:
        outcome = extract_fields(document_type, text)
    except Exception as error:
        message = " ".join(str(error).split()) or "Could not extract fields."
        if "/" in message or "\\" in message:
            message = "Could not extract fields."
        _set_field_status(document_id, "failed", message[:500])
        return

    if outcome.status != "completed":
        _set_field_status(document_id, outcome.status, outcome.error)
        return

    connection = connect()
    try:
        with connection:
            verified = {
                row["name"]
                for row in connection.execute(
                    """
                    SELECT name FROM document_fields
                    WHERE document_id = ? AND verification_status = 'verified'
                    """,
                    (document_id,),
                ).fetchall()
            }
            connection.execute(
                """
                DELETE FROM document_fields
                WHERE document_id = ? AND verification_status != 'verified'
                """,
                (document_id,),
            )
            for field in outcome.fields:
                if field.field_name in verified:
                    continue
                connection.execute(
                    """
                    INSERT INTO document_fields (
                        document_id, name, value, verification_status, source_text
                    ) VALUES (?, ?, ?, 'extracted', ?)
                    """,
                    (
                        document_id,
                        field.field_name,
                        field.extracted_value,
                        field.source_text,
                    ),
                )
            connection.execute(
                """
                UPDATE documents
                SET field_extraction_status = 'completed', field_extraction_error = NULL
                WHERE id = ?
                """,
                (document_id,),
            )
    finally:
        connection.close()


def _set_field_status(document_id: str, status: str, error) -> None:
    connection = connect()
    try:
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET field_extraction_status = ?, field_extraction_error = ?
                WHERE id = ?
                """,
                (status, error, document_id),
            )
    finally:
        connection.close()


def _mark_failed(document_id: str, error: Exception, fallback: str) -> None:
    message = " ".join(str(error).split()) or fallback
    if "/" in message or "\\" in message:
        message = fallback
    connection = connect()
    try:
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET status = 'failed', error_message = ?
                WHERE id = ?
                """,
                (message[:500], document_id),
            )
    finally:
        connection.close()


def _text_is_sparse(text: str, page_count: int) -> bool:
    """True when selectable text is too short to skip OCR."""
    body = re.sub(r"\[Page \d+\]", "", text or "")
    characters = len("".join(body.split()))
    pages = page_count if page_count > 0 else 1
    return characters < 20 * pages


@router.post("", response_model=DocumentRecord, status_code=201)
async def create_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> DocumentRecord:
    try:
        try:
            filename = safe_original_name(file.filename or "")
            suffix = extension_for(filename)
            media_type = media_type_for(suffix, file.content_type or "")
            document_id = str(uuid.uuid4())
            stored_path = save_upload(document_id, suffix, file.file)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
    finally:
        await file.close()

    connection = connect()
    try:
        try:
            with connection:
                connection.execute(
                    """
                    INSERT INTO documents (
                        id, filename, media_type, stored_path, page_count,
                        document_type, status, error_message, full_text,
                        field_extraction_status
                    ) VALUES (?, ?, ?, ?, NULL, NULL, 'uploaded', NULL, NULL, 'pending')
                    """,
                    (document_id, filename, media_type, stored_path),
                )
                row = fetch_document(connection, document_id)
                record = document_from_row(row)
        except Exception:
            delete_stored_file(stored_path)
            raise
    finally:
        connection.close()

    if media_type == "application/pdf":
        background_tasks.add_task(process_pdf_document, document_id)
    elif media_type.startswith("image/"):
        background_tasks.add_task(process_image_document, document_id)

    return record


@router.patch("/{document_id}", response_model=DocumentRecord)
def update_document_type(
    document_id: str,
    body: DocumentTypeUpdate,
    background_tasks: BackgroundTasks,
) -> DocumentRecord:
    document_type = body.document_type.strip().lower()
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported document type.")

    connection = connect()
    try:
        row = fetch_document(connection, document_id)
        text = row["full_text"] or ""
        extractable = row["status"] == "ready" and _can_extract(document_type, text)
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET document_type = ?, classification_confidence = NULL,
                    classification_status = 'verified',
                    classification_reasoning = 'Corrected manually.',
                    field_extraction_status = ?, field_extraction_error = NULL
                WHERE id = ?
                """,
                (
                    document_type,
                    "processing" if extractable else "needs_review",
                    document_id,
                ),
            )
            updated = document_from_row(fetch_document(connection, document_id))
    finally:
        connection.close()

    if extractable:
        background_tasks.add_task(run_field_extraction, document_id)
    return updated


@router.get("/{document_id}/fields", response_model=DocumentFieldsResponse)
def list_document_fields(document_id: str) -> DocumentFieldsResponse:
    connection = connect()
    try:
        document = fetch_document(connection, document_id)
        rows = connection.execute(
            """
            SELECT id, document_id, name, value, verification_status, source_text
            FROM document_fields
            WHERE document_id = ?
            ORDER BY id
            """,
            (document_id,),
        ).fetchall()
        document_type = document["document_type"]
        expected = list(FIELD_SCHEMAS.get(document_type, {}))
        return DocumentFieldsResponse(
            field_extraction_status=document["field_extraction_status"],
            field_extraction_error=document["field_extraction_error"],
            document_type=document_type,
            expected_fields=expected,
            fields=[
                DocumentField(
                    id=row["id"],
                    document_id=row["document_id"],
                    field_name=row["name"],
                    extracted_value=row["value"],
                    verification_status=row["verification_status"] or "extracted",
                    source_text=row["source_text"],
                )
                for row in rows
            ],
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
            """
            SELECT id, document_id, name, value, verification_status, source_text
            FROM document_fields
            WHERE id = ? AND document_id = ?
            """,
            (field_id, document_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Field not found.")
        with connection:
            connection.execute(
                """
                UPDATE document_fields
                SET value = ?, verification_status = 'verified'
                WHERE id = ? AND document_id = ?
                """,
                (value[:2000], field_id, document_id),
            )
        updated = connection.execute(
            """
            SELECT id, document_id, name, value, verification_status, source_text
            FROM document_fields
            WHERE id = ?
            """,
            (field_id,),
        ).fetchone()
        return DocumentField(
            id=updated["id"],
            document_id=updated["document_id"],
            field_name=updated["name"],
            extracted_value=updated["value"],
            verification_status=updated["verification_status"],
            source_text=updated["source_text"],
        )
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
        if not _can_extract(row["document_type"], row["full_text"] or ""):
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
            record = document_from_row(fetch_document(connection, document_id))
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
            record = document_from_row(fetch_document(connection, document_id))
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
