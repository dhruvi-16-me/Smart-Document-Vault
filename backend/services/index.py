import json
import threading
from typing import List, Optional

import faiss
import numpy as np

from config import DATA_DIR
from database import connect
from services.chunking import chunk_text
from services.embeddings import embed_model, embed_texts

INDEX_PATH = DATA_DIR / "search.faiss"
META_PATH = DATA_DIR / "search_meta.json"
_LOCK = threading.Lock()


def index_document(document_id: str) -> None:
    """Chunk and embed one ready document. Failures stay on index_status."""
    connection = connect()
    try:
        row = connection.execute(
            "SELECT status, full_text FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if row is None or row["status"] != "ready":
            return
        text = row["full_text"] or ""
        pieces = chunk_text(text)
        if not pieces:
            _set_index_status(connection, document_id, "skipped", None)
            _remove_document_chunks(document_id)
            return
        existing = connection.execute(
            """
            SELECT id, chunk_index, text FROM chunks
            WHERE document_id = ? ORDER BY chunk_index
            """,
            (document_id,),
        ).fetchall()
        same_text = [item["text"] for item in existing] == [piece["text"] for piece in pieces]
        if same_text and existing and _vectors_present([item["id"] for item in existing]):
            _set_index_status(connection, document_id, "indexed", None)
            return
        _set_index_status(connection, document_id, "processing", None)
    finally:
        connection.close()

    try:
        vectors = embed_texts([piece["text"] for piece in pieces])
        _store_chunks(document_id, pieces, vectors)
    except ValueError as error:
        _mark_index_failed(document_id, str(error))
    except Exception:
        _mark_index_failed(document_id, "Could not index this document.")


def remove_document_vectors(document_id: str) -> None:
    connection = connect()
    try:
        rows = connection.execute(
            "SELECT id FROM chunks WHERE document_id = ?",
            (document_id,),
        ).fetchall()
    finally:
        connection.close()
    _remove_ids([row["id"] for row in rows])


def search_vectors(vector: list, limit: int = 8) -> list:
    """Return chunk ids and similarity scores closest to a query vector."""
    if not vector:
        return []
    with _LOCK:
        index, meta = _load_index()
        if index is None or index.ntotal == 0:
            return []
        _require_compatible(meta, len(vector))
        query = _normalize(np.asarray([vector], dtype="float32"))
        scores, ids = index.search(query, min(limit, index.ntotal))
    hits = []
    for score, chunk_id in zip(scores[0], ids[0]):
        if int(chunk_id) < 0:
            continue
        hits.append({"chunk_id": int(chunk_id), "score": float(score)})
    return hits


def retrieve_passages(query: str, limit: int = 8) -> list:
    """Embed a query, search FAISS, and load the matching chunks from SQLite."""
    vector = embed_texts([query])[0]
    hits = search_vectors(vector, limit=limit)
    if not hits:
        return []
    connection = connect()
    try:
        passages = []
        for hit in hits:
            row = connection.execute(
                """
                SELECT chunks.id, chunks.chunk_index, chunks.page_number, chunks.text,
                       documents.id AS document_id, documents.filename, documents.document_type
                FROM chunks
                JOIN documents ON documents.id = chunks.document_id
                WHERE chunks.id = ?
                """,
                (hit["chunk_id"],),
            ).fetchone()
            if row is None:
                continue
            passages.append(
                {
                    "chunk_id": row["id"],
                    "chunk_index": row["chunk_index"],
                    "page_number": row["page_number"],
                    "text": row["text"],
                    "document_id": row["document_id"],
                    "filename": row["filename"],
                    "document_type": row["document_type"],
                    "score": round(float(hit["score"]), 4),
                }
            )
        return passages
    finally:
        connection.close()


def rebuild_index() -> int:
    """Rebuild the FAISS index from chunk text already stored in SQLite."""
    connection = connect()
    try:
        rows = connection.execute(
            "SELECT id, text FROM chunks ORDER BY id"
        ).fetchall()
    finally:
        connection.close()
    if not rows:
        _replace_index(None, None)
        return 0
    vectors = embed_texts([row["text"] for row in rows])
    _write_vectors([(row["id"], vector) for row, vector in zip(rows, vectors)], replace=True)
    return len(rows)


def add_vectors(vectors: list, chunk_ids: list) -> None:
    _write_vectors(list(zip(chunk_ids, vectors)), replace=False)


def _store_chunks(document_id: str, pieces: list, vectors: list) -> None:
    if len(pieces) != len(vectors):
        raise ValueError("The embedding model returned an unexpected response.")
    dimension = len(vectors[0])
    if any(len(vector) != dimension for vector in vectors):
        raise ValueError("The embedding model returned an unexpected response.")
    _remove_document_chunks(document_id)
    connection = connect()
    try:
        with connection:
            chunk_ids = []
            for piece in pieces:
                cursor = connection.execute(
                    """
                    INSERT INTO chunks (document_id, chunk_index, page_number, text)
                    VALUES (?, ?, ?, ?)
                    """,
                    (document_id, piece["chunk_index"], piece["page_number"], piece["text"]),
                )
                chunk_ids.append(cursor.lastrowid)
    finally:
        connection.close()
    add_vectors(vectors, chunk_ids)
    connection = connect()
    try:
        _set_index_status(connection, document_id, "indexed", None)
    finally:
        connection.close()


def _remove_document_chunks(document_id: str) -> None:
    remove_document_vectors(document_id)
    connection = connect()
    try:
        with connection:
            connection.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
    finally:
        connection.close()


def _vectors_present(chunk_ids: List[int]) -> bool:
    with _LOCK:
        index, meta = _load_index()
        if index is None or meta.get("model") != embed_model():
            return False
        present = _indexed_ids(index)
    return all(chunk_id in present for chunk_id in chunk_ids)


def _write_vectors(pairs: list, replace: bool) -> None:
    if not pairs:
        return
    dimension = len(pairs[0][1])
    with _LOCK:
        if replace:
            index = faiss.IndexIDMap2(faiss.IndexFlatIP(dimension))
            meta = {"model": embed_model(), "dimension": dimension}
        else:
            index, meta = _load_index()
            if index is None:
                index = faiss.IndexIDMap2(faiss.IndexFlatIP(dimension))
                meta = {"model": embed_model(), "dimension": dimension}
            else:
                _require_compatible(meta, dimension)
        ids = np.asarray([pair[0] for pair in pairs], dtype="int64")
        matrix = _normalize(np.asarray([pair[1] for pair in pairs], dtype="float32"))
        existing = _indexed_ids(index)
        stale = ids[np.isin(ids, list(existing))] if existing else np.asarray([], dtype="int64")
        if len(stale):
            index.remove_ids(stale)
        index.add_with_ids(matrix, ids)
        _save_index(index, meta)


def _replace_index(index, meta) -> None:
    with _LOCK:
        if index is None:
            if INDEX_PATH.exists():
                INDEX_PATH.unlink()
            if META_PATH.exists():
                META_PATH.unlink()
            return
        _save_index(index, meta)


def _remove_ids(chunk_ids: List[int]) -> None:
    if not chunk_ids:
        return
    with _LOCK:
        index, meta = _load_index()
        if index is None:
            return
        present = _indexed_ids(index)
        stale = [chunk_id for chunk_id in chunk_ids if chunk_id in present]
        if not stale:
            return
        index.remove_ids(np.asarray(stale, dtype="int64"))
        _save_index(index, meta)


def _load_index():
    if not INDEX_PATH.exists() or not META_PATH.exists():
        return None, {}
    try:
        index = faiss.read_index(str(INDEX_PATH))
        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError("The search index is damaged. Rebuild it and try again.") from error
    if not isinstance(meta, dict):
        raise ValueError("The search index is damaged. Rebuild it and try again.")
    return index, meta


def _save_index(index, meta: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(INDEX_PATH))
    META_PATH.write_text(json.dumps(meta), encoding="utf-8")


def _require_compatible(meta: dict, dimension: int) -> None:
    if meta.get("model") != embed_model() or meta.get("dimension") != dimension:
        raise ValueError("The embedding model changed. Rebuild the search index.")


def _indexed_ids(index) -> set:
    if index.ntotal == 0:
        return set()
    return set(int(item) for item in faiss.vector_to_array(index.id_map))


def _normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return matrix / norms


def _set_index_status(connection, document_id: str, status: str, error: Optional[str]) -> None:
    with connection:
        connection.execute(
            """
            UPDATE documents SET index_status = ?, index_error = ? WHERE id = ?
            """,
            (status, error, document_id),
        )


def _mark_index_failed(document_id: str, message: str) -> None:
    if "/" in message or "\\" in message:
        message = "Could not index this document."
    connection = connect()
    try:
        _set_index_status(connection, document_id, "failed", message[:500])
    finally:
        connection.close()
