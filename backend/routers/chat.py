import json
from itertools import chain

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models import ChatRequest
from services.rag import stream_answer

router = APIRouter(tags=["chat"])


@router.post("/chat")
def chat(body: ChatRequest) -> StreamingResponse:
    """Stream the answer as newline-delimited JSON: sources, tokens, then done."""
    events = stream_answer(
        body.message,
        [item.model_dump() for item in body.history],
        body.document_id,
    )
    try:
        # Retrieval runs here, so its failures become a normal HTTP error.
        first = next(events)
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return StreamingResponse(
        (json.dumps(event) + "\n" for event in _guarded(chain([first], events))),
        media_type="application/x-ndjson",
    )


def _guarded(events):
    try:
        yield from events
    except ValueError as error:
        yield {"type": "error", "message": str(error)}
