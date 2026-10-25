from fastapi import APIRouter, HTTPException, Query

from models import SearchHit, SearchResponse
from services.index import rebuild_index, retrieve_passages

router = APIRouter(tags=["search"])


def run_search(query: str) -> SearchResponse:
    text = " ".join(query.split())
    if not text:
        raise HTTPException(status_code=400, detail="Enter a search query.")
    try:
        passages = retrieve_passages(text, limit=8)
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return SearchResponse(
        results=[
            SearchHit(
                document_id=passage["document_id"],
                filename=passage["filename"],
                document_type=passage["document_type"],
                document_label=passage["document_label"],
                document_group=passage["document_group"],
                chunk_index=passage["chunk_index"],
                page_number=passage["page_number"],
                text=passage["text"],
                score=passage["score"],
            )
            for passage in passages
        ]
    )


@router.get("/search", response_model=SearchResponse)
def search_documents(q: str = Query("")) -> SearchResponse:
    return run_search(q)


@router.post("/search/rebuild")
def rebuild_search_index() -> dict:
    try:
        count = rebuild_index()
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"rebuilt": True, "chunks": count}
