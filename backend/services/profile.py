import calendar
import re
from typing import Optional

from pydantic import BaseModel

from database import connect

# Document field names that mean the same profile field.
# Dates are normalized only for date_of_birth, and only when unambiguous.
# Names, addresses, and identification numbers are stored as written.
FIELD_NAME_MAP = {
    "candidate_name": "full_name",
    "student_name": "full_name",
    "name": "full_name",
    "legal_name": "full_name",
    "dob": "date_of_birth",
    "birth_date": "date_of_birth",
    "passing_year": "graduation_year",
    "license_number": "drivers_license_number",
    "phone_number": "phone",
    "mobile": "phone",
}

PROFILE_FIELDS = (
    "full_name",
    "date_of_birth",
    "email",
    "phone",
    "address",
    "pan_number",
    "passport_number",
    "drivers_license_number",
    "school",
    "board",
    "graduation_year",
)

_MONTHS = {name.lower(): index for index, name in enumerate(calendar.month_name) if name}
_MONTHS.update(
    {name.lower(): index for index, name in enumerate(calendar.month_abbr) if name}
)


class ProfileRecord(BaseModel):
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


class ImportableRecord(BaseModel):
    document_id: str
    document_field_id: int
    document_filename: str
    field_name: str
    source_field_name: str
    field_value: str
    proposed_value: str


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


def canonical_field_name(name: str) -> Optional[str]:
    key = " ".join(name.strip().lower().split())
    mapped = FIELD_NAME_MAP.get(key, key)
    if mapped not in PROFILE_FIELDS:
        return None
    return mapped


def profile_value(field_name: str, value: str) -> str:
    cleaned = " ".join(value.split())
    if field_name == "date_of_birth":
        return unambiguous_iso_date(cleaned) or cleaned
    return cleaned


def unambiguous_iso_date(value: str, day_first: bool = False) -> Optional[str]:
    """Return YYYY-MM-DD only when the calendar date has one interpretation.

    With day_first, a numeric date like 05/04/2026 is read as 5 April, as Indian documents write it.
    """
    text = value.strip()
    iso = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", text)
    if iso:
        return _iso(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
    numeric = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", text)
    if numeric:
        first = int(numeric.group(1))
        second = int(numeric.group(2))
        year = int(numeric.group(3))
        if first > 12 and 1 <= second <= 12:
            return _iso(year, second, first)
        if second > 12 and 1 <= first <= 12:
            return _iso(year, first, second)
        if day_first:
            return _iso(year, second, first)
        return None
    named = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", text)
    if named and named.group(2).lower() in _MONTHS:
        return _iso(int(named.group(3)), _MONTHS[named.group(2).lower()], int(named.group(1)))
    named = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", text)
    if named and named.group(1).lower() in _MONTHS:
        return _iso(int(named.group(3)), _MONTHS[named.group(1).lower()], int(named.group(2)))
    return None


def values_match(field_name: str, left: str, right: str) -> bool:
    return _comparison_key(field_name, left) == _comparison_key(field_name, right)


def list_profile() -> list:
    connection = connect()
    try:
        rows = connection.execute(
            """
            SELECT profile_fields.*, documents.filename AS source_filename
            FROM profile_fields
            LEFT JOIN documents ON documents.id = profile_fields.source_document_id
            ORDER BY profile_fields.field_name
            """
        ).fetchall()
        return [_record(row) for row in rows]
    finally:
        connection.close()


def add_manual_field(field_name: str, field_value: str):
    canonical = canonical_field_name(field_name)
    if canonical is None:
        raise ValueError("Unsupported profile field.")
    stored = profile_value(canonical, field_value)
    if not stored:
        raise ValueError("Field value is required.")
    connection = connect()
    try:
        existing = _profile_row(connection, canonical)
        if existing is not None:
            if values_match(canonical, existing["field_value"], stored):
                return _record(_with_filename(connection, existing))
            return _conflict(connection, existing, stored, None, None, None)
        with connection:
            cursor = connection.execute(
                """
                INSERT INTO profile_fields (
                    field_name, field_value, verification_status
                ) VALUES (?, ?, 'manual')
                """,
                (canonical, stored),
            )
            row = connection.execute(
                "SELECT * FROM profile_fields WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            return _record(row)
    finally:
        connection.close()


def update_field(field_id: int, field_value: str) -> ProfileRecord:
    connection = connect()
    try:
        row = connection.execute(
            "SELECT * FROM profile_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        if row is None:
            raise LookupError("Profile field not found.")
        stored = profile_value(row["field_name"], field_value)
        if not stored:
            raise ValueError("Field value is required.")
        with connection:
            if values_match(row["field_name"], row["field_value"], stored):
                connection.execute(
                    "UPDATE profile_fields SET updated_at = datetime('now') WHERE id = ?",
                    (field_id,),
                )
            else:
                connection.execute(
                    """
                    UPDATE profile_fields
                    SET field_value = ?, verification_status = 'manual',
                        source_document_id = NULL, source_document_field_id = NULL,
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (stored, field_id),
                )
        updated = connection.execute(
            """
            SELECT profile_fields.*, documents.filename AS source_filename
            FROM profile_fields
            LEFT JOIN documents ON documents.id = profile_fields.source_document_id
            WHERE profile_fields.id = ?
            """,
            (field_id,),
        ).fetchone()
        return _record(updated)
    finally:
        connection.close()


def remove_field(field_id: int) -> None:
    connection = connect()
    try:
        row = connection.execute(
            "SELECT id FROM profile_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        if row is None:
            raise LookupError("Profile field not found.")
        with connection:
            connection.execute("DELETE FROM profile_fields WHERE id = ?", (field_id,))
    finally:
        connection.close()


def list_importable_fields() -> list:
    connection = connect()
    try:
        rows = connection.execute(
            """
            SELECT document_fields.id, document_fields.document_id, document_fields.name,
                   document_fields.value, documents.filename
            FROM document_fields
            JOIN documents ON documents.id = document_fields.document_id
            WHERE document_fields.verification_status = 'verified'
            ORDER BY documents.filename, document_fields.name
            """
        ).fetchall()
        records = []
        for row in rows:
            canonical = canonical_field_name(row["name"])
            if canonical is None:
                continue
            original = row["value"]
            records.append(
                ImportableRecord(
                    document_id=row["document_id"],
                    document_field_id=row["id"],
                    document_filename=row["filename"],
                    field_name=canonical,
                    source_field_name=row["name"],
                    field_value=original,
                    proposed_value=profile_value(canonical, original),
                )
            )
        return records
    finally:
        connection.close()


def import_verified_field(document_id: str, document_field_id: int):
    connection = connect()
    try:
        source = _verified_source(connection, document_id, document_field_id)
        canonical = canonical_field_name(source["name"])
        if canonical is None:
            raise ValueError("This document field cannot be added to the profile.")
        stored = profile_value(canonical, source["value"])
        existing = _profile_row(connection, canonical)
        if existing is not None:
            if values_match(canonical, existing["field_value"], stored):
                return _record(_with_filename(connection, existing))
            return _conflict(
                connection,
                existing,
                stored,
                source["filename"],
                document_id,
                document_field_id,
            )
        with connection:
            cursor = connection.execute(
                """
                INSERT INTO profile_fields (
                    field_name, field_value, source_document_id, source_document_field_id,
                    verification_status
                ) VALUES (?, ?, ?, ?, 'imported')
                """,
                (canonical, stored, document_id, document_field_id),
            )
            row = connection.execute(
                """
                SELECT profile_fields.*, documents.filename AS source_filename
                FROM profile_fields
                LEFT JOIN documents ON documents.id = profile_fields.source_document_id
                WHERE profile_fields.id = ?
                """,
                (cursor.lastrowid,),
            ).fetchone()
            return _record(row)
    finally:
        connection.close()


def resolve_conflict(
    action: str,
    document_id: Optional[str],
    document_field_id: Optional[int],
    field_name: Optional[str],
    field_value: Optional[str],
):
    if action not in {"keep", "replace"}:
        raise ValueError("Choose keep or replace.")
    if document_id and document_field_id:
        return _resolve_document_conflict(action, document_id, document_field_id)
    if field_name and field_value:
        return _resolve_manual_conflict(action, field_name, field_value)
    raise ValueError("A document field or a profile value is required.")


def _resolve_document_conflict(action: str, document_id: str, document_field_id: int):
    connection = connect()
    try:
        source = _verified_source(connection, document_id, document_field_id)
        canonical = canonical_field_name(source["name"])
        if canonical is None:
            raise ValueError("This document field cannot be added to the profile.")
        existing = _profile_row(connection, canonical)
        if existing is None:
            raise LookupError("Profile field not found.")
        if action == "keep":
            return _record(_with_filename(connection, existing))
        stored = profile_value(canonical, source["value"])
        with connection:
            connection.execute(
                """
                UPDATE profile_fields
                SET field_value = ?, source_document_id = ?, source_document_field_id = ?,
                    verification_status = 'imported', updated_at = datetime('now')
                WHERE id = ?
                """,
                (stored, document_id, document_field_id, existing["id"]),
            )
        updated = connection.execute(
            """
            SELECT profile_fields.*, documents.filename AS source_filename
            FROM profile_fields
            LEFT JOIN documents ON documents.id = profile_fields.source_document_id
            WHERE profile_fields.id = ?
            """,
            (existing["id"],),
        ).fetchone()
        return _record(updated)
    finally:
        connection.close()


def _resolve_manual_conflict(action: str, field_name: str, field_value: str):
    canonical = canonical_field_name(field_name)
    if canonical is None:
        raise ValueError("Unsupported profile field.")
    stored = profile_value(canonical, field_value)
    if not stored:
        raise ValueError("Field value is required.")
    connection = connect()
    try:
        existing = _profile_row(connection, canonical)
        if existing is None:
            raise LookupError("Profile field not found.")
        if action == "keep":
            return _record(_with_filename(connection, existing))
        with connection:
            connection.execute(
                """
                UPDATE profile_fields
                SET field_value = ?, verification_status = 'manual',
                    source_document_id = NULL, source_document_field_id = NULL,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (stored, existing["id"]),
            )
        updated = connection.execute(
            "SELECT * FROM profile_fields WHERE id = ?",
            (existing["id"],),
        ).fetchone()
        return _record(updated)
    finally:
        connection.close()


def _verified_source(connection, document_id: str, document_field_id: int):
    row = connection.execute(
        """
        SELECT document_fields.id, document_fields.document_id, document_fields.name,
               document_fields.value, document_fields.verification_status, documents.filename
        FROM document_fields
        JOIN documents ON documents.id = document_fields.document_id
        WHERE document_fields.id = ? AND document_fields.document_id = ?
        """,
        (document_field_id, document_id),
    ).fetchone()
    if row is None:
        raise LookupError("Document field not found.")
    if row["verification_status"] != "verified":
        raise ValueError("Only verified document fields can be imported.")
    return row


def _profile_row(connection, field_name: str):
    return connection.execute(
        "SELECT * FROM profile_fields WHERE field_name = ?",
        (field_name,),
    ).fetchone()


def _with_filename(connection, row):
    if row["source_document_id"] is None:
        return row
    filename = connection.execute(
        "SELECT filename FROM documents WHERE id = ?",
        (row["source_document_id"],),
    ).fetchone()
    data = dict(row)
    data["source_filename"] = filename["filename"] if filename else None
    return data


def _conflict(connection, existing, proposed_value, filename, document_id, field_id):
    source_name = None
    available = False
    if existing["source_document_id"]:
        found = connection.execute(
            "SELECT filename FROM documents WHERE id = ?",
            (existing["source_document_id"],),
        ).fetchone()
        if found is not None:
            source_name = found["filename"]
            available = True
    return ProfileConflict(
        field_name=existing["field_name"],
        existing_value=existing["field_value"],
        existing_source_filename=source_name,
        existing_source_available=available,
        proposed_value=proposed_value,
        proposed_source_filename=filename,
        proposed_document_id=document_id,
        proposed_document_field_id=field_id,
    )


def _record(row) -> ProfileRecord:
    filename = row["source_filename"] if "source_filename" in row.keys() else None
    available = bool(row["source_document_id"]) and bool(filename)
    return ProfileRecord(
        id=row["id"],
        field_name=row["field_name"],
        field_value=row["field_value"],
        verification_status=row["verification_status"],
        source_document_id=row["source_document_id"] if available else None,
        source_document_field_id=row["source_document_field_id"] if available else None,
        source_filename=filename if available else None,
        source_available=available,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _comparison_key(field_name: str, value: str) -> str:
    if field_name in {"pan_number", "passport_number", "drivers_license_number"}:
        return re.sub(r"\s+", "", value).casefold()
    if field_name == "date_of_birth":
        normalized = unambiguous_iso_date(value)
        if normalized:
            return normalized
    return " ".join(value.split()).casefold()


def _iso(year: int, month: int, day: int) -> Optional[str]:
    if year < 1900 or year > 2100 or month < 1 or month > 12:
        return None
    if day < 1 or day > calendar.monthrange(year, month)[1]:
        return None
    return "{:04d}-{:02d}-{:02d}".format(year, month, day)
