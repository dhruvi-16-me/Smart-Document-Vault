import json
import re
from typing import Dict, List, Optional

from database import connect
from services.classify import ClassificationOutcome, classify_document
from services.extract import extract_docx_text, extract_plain_text, read_pdf
from services.fields import extract_fields
from services.ocr import LOW_CONFIDENCE, ocr_image
from services.storage import DOCX_MEDIA_TYPE, is_readable, resolve_stored_path

MIN_EXTRACTION_CHARACTERS = 40


def process_document(document_id: str) -> None:
    """Read text from one stored document, then classify, extract fields, and index it."""
    row = _mark_processing(document_id)
    if row is None:
        return

    try:
        result = read_text(str(resolve_stored_path(row["stored_path"])), row["media_type"])
    except Exception as error:
        _mark_failed(document_id, error, "Could not read text from this document.")
        return

    _finish_document(
        document_id,
        row["filename"],
        str(result["text"]),
        int(result["page_count"]),
        result.get("pages", []),
    )


def read_text(file_path: str, media_type: str) -> Dict[str, object]:
    """Return {"text", "page_count"} for any readable format."""
    if media_type == "application/pdf":
        return read_pdf(file_path)
    if media_type.startswith("image/"):
        return ocr_image(file_path, media_type)
    if media_type == DOCX_MEDIA_TYPE:
        return extract_docx_text(file_path)
    if media_type.startswith("text/"):
        return extract_plain_text(file_path)
    raise ValueError("This file type cannot be read.")


def can_extract(document_type: Optional[str], text: str) -> bool:
    if not document_type:
        return False
    body = re.sub(r"\[Page \d+\]", "", text or "")
    return len("".join(body.split())) >= MIN_EXTRACTION_CHARACTERS


def run_field_extraction(document_id: str) -> None:
    connection = connect()
    try:
        row = connection.execute(
            "SELECT status, document_type, document_label, full_text FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if row is None or row["status"] != "ready":
            return
        document_type = row["document_type"]
        document_label = row["document_label"]
        text = row["full_text"] or ""
        if not can_extract(document_type, text):
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
        outcome = extract_fields(document_type, text, document_label)
    except Exception as error:
        _set_field_status(document_id, "failed", _public_message(error, "Could not extract fields."))
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
                        document_id, name, value, label, kind, date_role, normalized_value,
                        page_number, verification_status, source_text
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?)
                    """,
                    (
                        document_id,
                        field.field_name,
                        field.extracted_value,
                        field.label,
                        field.kind,
                        field.date_role,
                        field.normalized_value,
                        field.page_number,
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


def _mark_processing(document_id: str):
    connection = connect()
    try:
        row = connection.execute(
            "SELECT filename, media_type, stored_path FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if row is None or not is_readable(row["media_type"]):
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
        return row
    finally:
        connection.close()


def _finish_document(
    document_id: str, filename: str, text: str, page_count: int, pages: List[dict]
) -> None:
    try:
        classification = classify_document(text, filename)
    except Exception as error:
        classification = ClassificationOutcome(
            reasoning=_public_message(error, "Could not classify this document."),
            status="failed",
        )
    extractable = can_extract(classification.document_type, text)

    connection = connect()
    try:
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET full_text = ?, page_count = ?, ocr_confidence = ?, low_confidence_pages = ?,
                    status = 'ready', error_message = NULL,
                    document_type = ?, document_label = ?, document_group = ?,
                    classification_confidence = ?, classification_status = ?,
                    classification_method = ?, classification_reasoning = ?,
                    field_extraction_status = ?, field_extraction_error = NULL
                WHERE id = ?
                """,
                (
                    text,
                    page_count,
                    *_ocr_quality(pages),
                    classification.document_type,
                    classification.document_label,
                    classification.document_group,
                    classification.confidence,
                    classification.status,
                    classification.method,
                    classification.reasoning,
                    "processing" if extractable else "needs_review",
                    document_id,
                ),
            )
    finally:
        connection.close()

    if extractable:
        run_field_extraction(document_id)
    # Imported here so the FAISS index loads only when a document is indexed.
    from services.index import _mark_index_failed, index_document

    try:
        index_document(document_id)
    except Exception:
        _mark_index_failed(document_id, "Could not index this document.")


def _ocr_quality(pages: List[dict]):
    """Mean OCR confidence over OCR'd pages, and the pages below LOW_CONFIDENCE as JSON."""
    scores = [
        (page["page_number"], page["ocr_confidence"])
        for page in pages
        if page.get("ocr_confidence") is not None
    ]
    if not scores:
        return None, None
    mean = round(sum(score for _, score in scores) / len(scores), 1)
    low = [number for number, score in scores if score < LOW_CONFIDENCE]
    return mean, json.dumps(low) if low else None


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
    connection = connect()
    try:
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET status = 'failed', error_message = ?,
                    field_extraction_status = 'skipped', index_status = 'skipped'
                WHERE id = ?
                """,
                (_public_message(error, fallback), document_id),
            )
    finally:
        connection.close()


def _public_message(error: Exception, fallback: str) -> str:
    """Error text safe to show in the UI. Messages that contain paths are replaced."""
    message = " ".join(str(error).split()) or fallback
    if "/" in message or "\\" in message:
        message = fallback
    return message[:500]
