import sqlite3
from pathlib import Path

from config import DATA_DIR, DATABASE_PATH

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    connection = connect()
    try:
        with connection:
            if _documents_id_is_integer(connection):
                connection.executescript(
                    """
                    DROP TABLE IF EXISTS chunks;
                    DROP TABLE IF EXISTS document_fields;
                    DROP TABLE IF EXISTS profile_fields;
                    DROP TABLE IF EXISTS documents;
                    """
                )
            connection.executescript(schema)
            _ensure_classification_columns(connection)
            _ensure_field_columns(connection)
            _ensure_profile_table(connection)
            _ensure_index_columns(connection)
    finally:
        connection.close()


def _ensure_classification_columns(connection: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(documents)").fetchall()
    }
    additions = (
        ("classification_confidence", "REAL"),
        ("classification_status", "TEXT"),
        ("classification_reasoning", "TEXT"),
    )
    for name, column_type in additions:
        if name not in existing:
            connection.execute(
                "ALTER TABLE documents ADD COLUMN {} {}".format(name, column_type)
            )


def _ensure_field_columns(connection: sqlite3.Connection) -> None:
    document_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(documents)").fetchall()
    }
    for name, column_type in (
        ("field_extraction_status", "TEXT"),
        ("field_extraction_error", "TEXT"),
    ):
        if name not in document_columns:
            connection.execute(
                "ALTER TABLE documents ADD COLUMN {} {}".format(name, column_type)
            )

    field_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(document_fields)").fetchall()
    }
    additions = (
        ("verification_status", "TEXT NOT NULL DEFAULT 'extracted'"),
        ("source_text", "TEXT"),
    )
    for name, column_type in additions:
        if name not in field_columns:
            connection.execute(
                "ALTER TABLE document_fields ADD COLUMN {} {}".format(name, column_type)
            )


def _ensure_profile_table(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(profile_fields)").fetchall()
    }
    if "field_name" in columns and "source_document_field_id" in columns:
        return
    connection.execute(
        """
        CREATE TABLE profile_fields_next (
            id INTEGER PRIMARY KEY,
            field_name TEXT NOT NULL UNIQUE,
            field_value TEXT NOT NULL,
            source_document_id TEXT,
            source_document_field_id INTEGER,
            verification_status TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (source_document_id) REFERENCES documents (id) ON DELETE SET NULL,
            FOREIGN KEY (source_document_field_id) REFERENCES document_fields (id) ON DELETE SET NULL
        )
        """
    )
    if "key" in columns:
        connection.execute(
            """
            INSERT INTO profile_fields_next (
                field_name, field_value, source_document_id, verification_status,
                created_at, updated_at
            )
            SELECT key, value, source_document_id, 'manual', updated_at, updated_at
            FROM profile_fields
            WHERE value IS NOT NULL AND trim(value) != ''
            """
        )
    connection.execute("DROP TABLE profile_fields")
    connection.execute("ALTER TABLE profile_fields_next RENAME TO profile_fields")


def _ensure_index_columns(connection: sqlite3.Connection) -> None:
    document_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(documents)").fetchall()
    }
    for name, column_type in (
        ("index_status", "TEXT"),
        ("index_error", "TEXT"),
    ):
        if name not in document_columns:
            connection.execute(
                "ALTER TABLE documents ADD COLUMN {} {}".format(name, column_type)
            )
    chunk_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(chunks)").fetchall()
    }
    if "page_number" not in chunk_columns:
        connection.execute("ALTER TABLE chunks ADD COLUMN page_number INTEGER")


def _documents_id_is_integer(connection: sqlite3.Connection) -> bool:
    columns = connection.execute("PRAGMA table_info(documents)").fetchall()
    for column in columns:
        if column["name"] == "id":
            return str(column["type"]).upper() != "TEXT"
    return False
