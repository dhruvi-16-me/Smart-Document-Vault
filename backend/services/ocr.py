from typing import Dict, List, NamedTuple, Optional

import fitz
import pytesseract
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

try:
    from pillow_heif import register_heif_opener
except ImportError:  # HEIC photos need pillow-heif; other images still work without it.
    HEIC_SUPPORTED = False
else:
    register_heif_opener()
    HEIC_SUPPORTED = True

MAX_OCR_EDGE = 2500
OCR_DPI = 200
MAX_IMAGE_PAGES = 50
# Small scans are enlarged so letters reach the size Tesseract reads best.
UPSCALE_BELOW_EDGE = 1600
# Tesseract's orientation confidence; below this the detected rotation is a guess.
MIN_ORIENTATION_CONFIDENCE = 2.0
# Mean word confidence (0-100) below which a page is flagged; clean scans score 93-96.
LOW_CONFIDENCE = 85.0


class PageText(NamedTuple):
    text: str
    source: str  # "text" for selectable PDF text, "ocr" for Tesseract
    confidence: Optional[float] = None


def ocr_image(file_path: str, media_type: str = "") -> Dict[str, object]:
    """Read text from an image, with [Page n] markers like PDFs.

    Phone photos are turned upright from their EXIF orientation first. The original
    file is not saved or modified.
    """
    if media_type in {"image/heic", "image/heif"} and not HEIC_SUPPORTED:
        raise ValueError("HEIC support is not installed. Run: pip install -r requirements.txt")
    try:
        with Image.open(file_path) as image:
            pages = []
            for frame in ImageSequence.Iterator(image):
                if len(pages) >= MAX_IMAGE_PAGES:
                    break
                pages.append(ocr_page_image(ImageOps.exif_transpose(frame)))
    except UnidentifiedImageError as error:
        raise ValueError("Could not open this image.") from error
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("Could not open this image.") from error
    return join_pages(pages)


def ocr_pdf_page(page: fitz.Page) -> PageText:
    """Render one PDF page in memory and OCR it."""
    zoom = OCR_DPI / 72
    longest = max(page.rect.width * zoom, page.rect.height * zoom, 1)
    if longest > MAX_OCR_EDGE:
        zoom *= MAX_OCR_EDGE / longest
    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY, alpha=False)
    image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    try:
        return ocr_page_image(image)
    finally:
        image.close()


def ocr_page_image(image: Image.Image) -> PageText:
    """Enlarge small scans, turn the page upright, then OCR it in one Tesseract pass."""
    prepared = image.convert("L")
    longest = max(prepared.size)
    if longest < UPSCALE_BELOW_EDGE:
        scale = UPSCALE_BELOW_EDGE / longest
        prepared = prepared.resize(
            (round(prepared.width * scale), round(prepared.height * scale)), Image.LANCZOS
        )
    prepared = _upright(prepared)
    return _read_words(prepared)


def join_pages(pages: List[PageText]) -> Dict[str, object]:
    """Combine pages into one text with [Page n] markers and per-page details."""
    details = [
        {
            "page_number": number,
            "source": page.source,
            "ocr_confidence": None if page.confidence is None else round(page.confidence, 1),
        }
        for number, page in enumerate(pages, start=1)
    ]
    if not any(page.text for page in pages):
        text = ""
    else:
        text = "\n\n".join(
            f"[Page {number}]\n{page.text}" for number, page in enumerate(pages, start=1)
        )
    return {"text": text, "page_count": len(pages), "pages": details}


def _upright(image: Image.Image) -> Image.Image:
    try:
        orientation = _tesseract(
            pytesseract.image_to_osd, image, output_type=pytesseract.Output.DICT
        )
    except ValueError:
        # Tesseract cannot judge orientation on pages with very little text.
        return image
    rotate = int(orientation.get("rotate", 0))
    if rotate and float(orientation.get("orientation_conf", 0)) >= MIN_ORIENTATION_CONFIDENCE:
        return image.rotate(-rotate, expand=True, fillcolor=255)
    return image


def _read_words(image: Image.Image) -> PageText:
    data = _tesseract(pytesseract.image_to_data, image, output_type=pytesseract.Output.DICT)
    lines: List[str] = []
    confidences: List[float] = []
    current_line = None
    current_block = None
    words: List[str] = []
    for index, word in enumerate(data["text"]):
        word = word.strip()
        if not word:
            continue
        block = data["block_num"][index]
        line = (block, data["par_num"][index], data["line_num"][index])
        if line != current_line:
            if words:
                lines.append(" ".join(words))
            if current_block is not None and block != current_block:
                lines.append("")
            words, current_line, current_block = [], line, block
        words.append(word)
        confidence = float(data["conf"][index])
        if confidence >= 0:
            confidences.append(confidence)
    if words:
        lines.append(" ".join(words))
    confidence = sum(confidences) / len(confidences) if confidences else None
    return PageText("\n".join(lines).strip(), "ocr", confidence)


def _tesseract(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except pytesseract.TesseractNotFoundError as error:
        raise ValueError(
            "Tesseract is not installed. On macOS, install it with: brew install tesseract"
        ) from error
    except Exception as error:
        message = " ".join(str(error).split())
        if not message or "/" in message or "\\" in message:
            message = "Could not read text from this document."
        raise ValueError(message) from error
