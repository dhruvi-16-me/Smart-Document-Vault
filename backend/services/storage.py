import shutil
from pathlib import Path
from typing import BinaryIO

from config import DATA_DIR

DOCUMENTS_DIR = DATA_DIR / "documents"
CHUNK_SIZE = 1024 * 1024

ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

CONTENT_TYPE_ALIASES = {
    "image/jpg": "image/jpeg",
}


def safe_original_name(filename: str) -> str:
    """Keep only the base name so a client cannot choose the storage path."""
    name = Path(filename or "").name.replace("\x00", "").strip()
    if not name or name in {".", ".."}:
        raise ValueError("A file name is required.")
    if len(name) > 255:
        raise ValueError("The file name is too long.")
    return name


def extension_for(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError("Only PDF, PNG, JPG, and WEBP files are supported.")
    return suffix


def media_type_for(suffix: str, content_type: str) -> str:
    expected = ALLOWED_EXTENSIONS[suffix]
    normalized = content_type.split(";", 1)[0].strip().lower()
    if normalized in {"", "application/octet-stream"}:
        return expected
    normalized = CONTENT_TYPE_ALIASES.get(normalized, normalized)
    if normalized != expected:
        raise ValueError("The file type does not match its extension.")
    return expected


def save_upload(document_id: str, suffix: str, source: BinaryIO) -> str:
    """Copy an upload stream into documents/<id>.<extension> without changing the bytes."""
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError("Only PDF, PNG, JPG, and WEBP files are supported.")
    if not document_id or document_id in {".", ".."} or "/" in document_id or "\\" in document_id:
        raise ValueError("Invalid document id.")

    documents_root = DOCUMENTS_DIR.resolve()
    destination = (documents_root / f"{document_id}{suffix}").resolve()
    if documents_root not in destination.parents:
        raise ValueError("Invalid storage path.")

    header = source.read(16)
    if not _matches_signature(suffix, header):
        raise ValueError("The file is not a valid PDF or image.")

    documents_root.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open("wb") as output:
            output.write(header)
            shutil.copyfileobj(source, output, length=CHUNK_SIZE)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    return f"documents/{document_id}{suffix}"


def delete_stored_file(stored_path: str) -> None:
    """Delete a stored document file. Missing files are ignored."""
    target = resolve_stored_path(stored_path)
    if target.is_file():
        target.unlink()


def resolve_stored_path(stored_path: str) -> Path:
    path = Path(stored_path)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("Refusing to use a file outside document storage.")
    documents_root = DOCUMENTS_DIR.resolve()
    target = (DATA_DIR / path).resolve()
    if documents_root not in target.parents:
        raise ValueError("Refusing to use a file outside document storage.")
    return target


def _matches_signature(suffix: str, header: bytes) -> bool:
    if suffix == ".pdf":
        return header.startswith(b"%PDF")
    if suffix == ".png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return header.startswith(b"\xff\xd8\xff")
    if suffix == ".webp":
        return len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    return False
