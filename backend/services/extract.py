import zipfile
from typing import Dict, List, Union

import docx
import fitz
from docx.opc.exceptions import PackageNotFoundError
from docx.table import Table

from services.ocr import PageText, join_pages, ocr_pdf_page

MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024
# A page with less selectable text than this is treated as a scan and OCR'd.
MIN_SELECTABLE_CHARACTERS = 20


def read_pdf(file_path: str) -> Dict[str, object]:
    """Read each PDF page's selectable text, and OCR only the pages that have none.

    The file is opened for reading and is not saved.
    """
    try:
        document = fitz.open(file_path)
    except fitz.FileDataError as error:
        raise ValueError("This PDF is damaged and could not be read.") from error
    except Exception as error:
        raise ValueError("Could not open this PDF.") from error

    try:
        if document.is_encrypted and not document.authenticate(""):
            raise ValueError("This PDF is encrypted and cannot be read.")
        pages = []
        for page in document:
            text = page.get_text("text").strip()
            if len("".join(text.split())) >= MIN_SELECTABLE_CHARACTERS:
                pages.append(PageText(text, "text"))
            else:
                pages.append(ocr_pdf_page(page))
        return join_pages(pages)
    finally:
        document.close()


def extract_docx_text(file_path: str) -> Dict[str, Union[str, int]]:
    """Read paragraphs and tables from a Word file in document order.

    Word files have no fixed pages, so the text has no page markers.
    """
    try:
        document = docx.Document(file_path)
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError) as error:
        raise ValueError("This Word document is damaged or password protected.") from error
    except Exception as error:
        raise ValueError("Could not open this Word document.") from error

    lines: List[str] = []
    for block in document.iter_inner_content():
        if isinstance(block, Table):
            lines.extend(_table_lines(block))
        else:
            text = block.text.strip()
            if text:
                lines.append(text)
    return {"text": "\n".join(lines), "page_count": 1}


def extract_plain_text(file_path: str) -> Dict[str, Union[str, int]]:
    """Read a text, Markdown, or CSV file. Very large files are cut at 10 MB."""
    with open(file_path, "rb") as handle:
        data = handle.read(MAX_TEXT_FILE_BYTES)
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = data.decode("utf-16", errors="replace")
    elif b"\x00" in data:
        raise ValueError("This file does not contain plain text.")
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp1252", errors="replace")
    return {"text": text.replace("\r\n", "\n").strip(), "page_count": 1}


def _table_lines(table: Table) -> List[str]:
    lines = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            text = " ".join(cell.text.split())
            # Merged cells repeat the same text once per grid column.
            if text and (not cells or cells[-1] != text):
                cells.append(text)
        if cells:
            lines.append(" | ".join(cells))
    return lines
