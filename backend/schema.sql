CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    page_count INTEGER,
    document_type TEXT,
    document_label TEXT,
    document_group TEXT,
    classification_confidence REAL,
    classification_status TEXT,
    classification_method TEXT,
    classification_reasoning TEXT,
    field_extraction_status TEXT,
    field_extraction_error TEXT,
    index_status TEXT,
    index_error TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    full_text TEXT,
    ocr_confidence REAL,
    low_confidence_pages TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_fields (
    id INTEGER PRIMARY KEY,
    document_id TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT,
    kind TEXT,
    date_role TEXT,
    normalized_value TEXT,
    page_number INTEGER,
    verification_status TEXT NOT NULL DEFAULT 'extracted',
    source_text TEXT,
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT NOT NULL,
    tag TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (document_id, tag),
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_fields (
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
);

CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    page_number INTEGER,
    text TEXT NOT NULL,
    UNIQUE (document_id, chunk_index),
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);
