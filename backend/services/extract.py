from typing import Dict, Union

import fitz


def extract_pdf_text(file_path: str) -> Dict[str, Union[str, int]]:
    """Read text from a digital PDF. The file is opened for reading and is not saved."""
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
            page_text = document[index].get_text("text").strip()
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
