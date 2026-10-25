from typing import Dict, Union

import fitz
import pytesseract
from PIL import Image, UnidentifiedImageError

MAX_OCR_EDGE = 2500
OCR_DPI = 200


def ocr_image(file_path: str) -> str:
    """Read text from an image. The original file is not saved or modified."""
    try:
        with Image.open(file_path) as image:
            prepared = image.convert("L")
            try:
                text = _read_image(prepared)
            finally:
                if prepared is not image:
                    prepared.close()
    except UnidentifiedImageError as error:
        raise ValueError("Could not open this image.") from error
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("Could not open this image.") from error
    return _clean_text(text)


def ocr_pdf(file_path: str) -> Dict[str, Union[str, int]]:
    """OCR each PDF page. Rendered images stay in memory and are discarded."""
    try:
        document = fitz.open(file_path)
    except fitz.FileDataError as error:
        raise ValueError("This PDF is damaged and could not be read.") from error
    except Exception as error:
        raise ValueError("Could not open this PDF.") from error

    try:
        if document.is_encrypted and not document.authenticate(""):
            raise ValueError("This PDF is encrypted and cannot be read.")

        page_count = document.page_count
        pages = []
        has_text = False
        for index in range(page_count):
            page_text = _ocr_pdf_page(document[index])
            if page_text:
                has_text = True
            pages.append((index + 1, page_text))

        if not has_text:
            return {"text": "", "page_count": page_count}

        text = "\n\n".join(
            f"[Page {number}]\n{page_text}" for number, page_text in pages
        )
        return {"text": text, "page_count": page_count}
    finally:
        document.close()


def _ocr_pdf_page(page: fitz.Page) -> str:
    zoom = OCR_DPI / 72
    width = page.rect.width * zoom
    height = page.rect.height * zoom
    longest = max(width, height, 1)
    if longest > MAX_OCR_EDGE:
        zoom *= MAX_OCR_EDGE / longest

    pixmap = page.get_pixmap(
        matrix=fitz.Matrix(zoom, zoom),
        colorspace=fitz.csGRAY,
        alpha=False,
    )
    try:
        image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    finally:
        pixmap = None
    try:
        return _clean_text(_read_image(image))
    finally:
        image.close()


def _read_image(image: Image.Image) -> str:
    try:
        return pytesseract.image_to_string(image)
    except pytesseract.TesseractNotFoundError as error:
        raise ValueError(
            "Tesseract is not installed. On macOS, install it with: brew install tesseract"
        ) from error
    except Exception as error:
        message = " ".join(str(error).split())
        if not message or "/" in message or "\\" in message:
            message = "Could not read text from this document."
        raise ValueError(message) from error


def _clean_text(text: str) -> str:
    return text.replace("\x0c", "").strip()
