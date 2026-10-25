from fastapi import APIRouter, HTTPException

from models import ChatRequest, ChatResponse
from services.rag import answer_question

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    try:
        result = answer_question(
            body.message,
            [item.model_dump() for item in body.history],
        )
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return ChatResponse(**result)
