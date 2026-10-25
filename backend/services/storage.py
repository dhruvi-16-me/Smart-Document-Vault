import mimetypes
import re
import shutil
from pathlib import Path
from typing import BinaryIO, NamedTuple, Optional

from config import DATA_DIR

DOCUMENTS_DIR = DATA_DIR / "documents"
CHUNK_SIZE = 1024 * 1024
HEADER_SIZE = 16

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Formats whose text the app can read. Any other file is still stored, just not read.
READABLE_FORMATS = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".docx": DOCX_MEDIA_TYPE,
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
}

FORMAT_NAMES = {
    ".pdf": "PDF",
    ".png": "PNG",
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".webp": "WEBP",
    ".heic": "HEIC",
    ".heif": "HEIF",
    ".tif": "TIFF",
    ".tiff": "TIFF",
    ".docx": "Word",
}

_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}


class StoredUpload(NamedTuple):
    stored_path: str
    media_type: str
    # Why a file in a readable format will not be read, if it will not.
    note: Optional[str]


def safe_original_name(filename: str) -> str:
    """Keep only the base name so a client cannot choose the storage path."""
    name = Path(filename or "").name.replace("\x00", "").strip()
    if not name or name in {".", ".."}:
        raise ValueError("A file name is required.")
    if len(name) > 255:
        raise ValueError("The file name is too long.")
    return name


def extension_for(filename: str) -> str:
    """Return a safe lowercase extension, or an empty string when there is none."""
    suffix = Path(filename).suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) else ""


def is_readable(media_type: str) -> bool:
    return media_type in READABLE_FORMATS.values()


def save_upload(document_id: str, filename: str, source: BinaryIO) -> StoredUpload:
    """Copy an upload stream into documents/<id><extension> without changing the bytes.

    Any file is accepted. The stored format comes from the file's bytes when they are
    recognised, so a PNG named .jpg is still read as an image.
    """
    if not document_id or document_id in {".", ".."} or "/" in document_id or "\\" in document_id:
        raise ValueError("Invalid document id.")

    header = source.read(HEADER_SIZE)
    if not header:
        raise ValueError("The file is empty.")
    suffix, media_type, note = _storage_format(filename, header)

    documents_root = DOCUMENTS_DIR.resolve()
    destination = (documents_root / f"{document_id}{suffix}").resolve()
    if documents_root not in destination.parents:
        raise ValueError("Invalid storage path.")

    documents_root.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open("wb") as output:
            output.write(header)
            shutil.copyfileobj(source, output, length=CHUNK_SIZE)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    return StoredUpload(f"documents/{document_id}{suffix}", media_type, note)


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


def _storage_format(filename: str, header: bytes):
    suffix = extension_for(filename)
    sniffed = _sniff_suffix(header)
    if suffix in FORMAT_NAMES:
        if _matches_signature(suffix, header):
            return suffix, READABLE_FORMATS[suffix], None
        if sniffed:
            return sniffed, READABLE_FORMATS[sniffed], None
        note = "This file is named .{} but its contents are not a valid {} file, so it was stored without reading.".format(
            suffix[1:], FORMAT_NAMES[suffix]
        )
        return suffix, "application/octet-stream", note
    if sniffed:
        return sniffed, READABLE_FORMATS[sniffed], None
    if suffix in READABLE_FORMATS:
        return suffix, READABLE_FORMATS[suffix], None
    guessed = mimetypes.guess_type("file" + suffix)[0] if suffix else None
    return suffix, guessed or "application/octet-stream", None


def _sniff_suffix(header: bytes) -> Optional[str]:
    """Recognise readable binary formats by their first bytes. Word files are zip
    archives like many other formats, so they are only trusted by extension."""
    for suffix in (".pdf", ".png", ".jpg", ".webp", ".heic", ".tiff"):
        if _matches_signature(suffix, header):
            return suffix
    return None


def _matches_signature(suffix: str, header: bytes) -> bool:
    if suffix == ".pdf":
        return header.startswith(b"%PDF")
    if suffix == ".png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return header.startswith(b"\xff\xd8\xff")
    if suffix == ".webp":
        return len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    if suffix in {".heic", ".heif"}:
        return len(header) >= 12 and header[4:8] == b"ftyp" and header[8:12] in _HEIF_BRANDS
    if suffix in {".tif", ".tiff"}:
        return header.startswith((b"II*\x00", b"MM\x00*"))
    if suffix == ".docx":
        return header.startswith(b"PK\x03\x04")
    return False
