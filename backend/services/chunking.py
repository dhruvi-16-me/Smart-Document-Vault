import os
import re
from typing import List, Optional


def chunk_size() -> int:
    return max(200, int(os.environ.get("CHUNK_SIZE", "800")))


def chunk_overlap() -> int:
    overlap = int(os.environ.get("CHUNK_OVERLAP", "120"))
    return max(0, min(overlap, chunk_size() // 2))


def chunk_text(text: str) -> List[dict]:
    """Split extracted text into overlapping chunks. Empty pieces are dropped."""
    chunks = []
    for page_number, page_text in _pages(text or ""):
        for piece in _windows(page_text):
            chunks.append(
                {
                    "text": piece,
                    "page_number": page_number,
                    "chunk_index": len(chunks),
                }
            )
    return chunks


def _pages(text: str):
    matches = list(re.finditer(r"\[Page (\d+)\]", text))
    if not matches:
        yield None, text
        return
    if matches[0].start() > 0:
        yield None, text[: matches[0].start()]
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        yield int(match.group(1)), text[start:end]


def _windows(text: str) -> List[str]:
    body = text.strip()
    if not body:
        return []
    size = chunk_size()
    overlap = chunk_overlap()
    step = max(1, size - overlap)
    pieces = []
    start = 0
    while start < len(body):
        piece = body[start : start + size].strip()
        if piece:
            pieces.append(piece)
        if start + size >= len(body):
            break
        start += step
    return pieces
