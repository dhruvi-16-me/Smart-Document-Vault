"""Page images for the UI. Rendered in memory on request; nothing is written to disk."""
import io
from typing import Optional

import fitz
from PIL import Image, ImageOps, ImageSequence

from services.ocr import HEIC_SUPPORTED

# Browsers display these as they are, so the stored file is served directly.
BROWSER_NATIVE = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
# Browsers cannot display these, so pages are converted to JPEG.
CONVERTED = {"image/heic", "image/heif", "image/tiff"}

PREVIEW_EDGE = 2000
THUMBNAIL_EDGE = 360


def can_preview(media_type: str) -> bool:
    return media_type in BROWSER_NATIVE or media_type in CONVERTED


def page_jpeg(file_path: str, media_type: str, page: int, max_edge: int) -> Optional[bytes]:
    """Return one page as JPEG bytes, or None when the page does not exist."""
    if media_type == "application/pdf":
        return _pdf_page(file_path, page, max_edge)
    if media_type.startswith("image/"):
        if media_type in {"image/heic", "image/heif"} and not HEIC_SUPPORTED:
            return None
        return _image_page(file_path, page, max_edge)
    return None


def _pdf_page(file_path: str, page: int, max_edge: int) -> Optional[bytes]:
    document = fitz.open(file_path)
    try:
        if document.is_encrypted and not document.authenticate(""):
            return None
        if page < 1 or page > document.page_count:
            return None
        target = document[page - 1]
        zoom = max_edge / max(target.rect.width, target.rect.height, 1)
        pixmap = target.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        return _jpeg(image, max_edge)
    finally:
        document.close()


def _image_page(file_path: str, page: int, max_edge: int) -> Optional[bytes]:
    with Image.open(file_path) as image:
        for number, frame in enumerate(ImageSequence.Iterator(image), start=1):
            if number == page:
                return _jpeg(ImageOps.exif_transpose(frame), max_edge)
    return None


def _jpeg(image: Image.Image, max_edge: int) -> bytes:
    image = image.convert("RGB")
    image.thumbnail((max_edge, max_edge))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()
