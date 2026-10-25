import json
import os
import re
import urllib.error
import urllib.request
from typing import Optional

from pydantic import BaseModel, ValidationError, field_validator

DOCUMENT_TYPES = (
    "aadhaar",
    "pan",
    "marksheet_10",
    "marksheet_12",
    "degree_certificate",
    "passport",
    "drivers_license",
    "medical",
    "insurance",
    "resume",
    "other",
)

MIN_CLASSIFICATION_CHARACTERS = 40
OLLAMA_TIMEOUT_SECONDS = 120


class ModelClassification(BaseModel):
    document_type: str
    confidence: float
    reasoning: str

    @field_validator("document_type", mode="before")
    @classmethod
    def normalize_document_type(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("document_type must be a string")
        normalized = value.strip().lower()
        if normalized not in DOCUMENT_TYPES:
            raise ValueError("document_type is not a supported category")
        return normalized

    @field_validator("confidence")
    @classmethod
    def check_confidence(cls, value: float) -> float:
        if value < 0 or value > 1:
            raise ValueError("confidence must be between 0 and 1")
        return value

    @field_validator("reasoning")
    @classmethod
    def check_reasoning(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("reasoning is required")
        return cleaned[:500]


class ClassificationOutcome(BaseModel):
    document_type: Optional[str] = None
    confidence: Optional[float] = None
    reasoning: str
    status: str


def classify_document(text: str) -> ClassificationOutcome:
    """Classify extracted text. Connection and parse failures stay inside the outcome."""
    if _text_is_insufficient(text):
        return ClassificationOutcome(
            reasoning="Not enough extracted text to classify this document.",
            status="needs_review",
        )

    try:
        raw = request_ollama(text)
        parsed = parse_model_classification(raw)
    except ValueError as error:
        return ClassificationOutcome(
            reasoning=_public_message(error, "The model returned an invalid classification."),
            status="failed",
        )

    return ClassificationOutcome(
        document_type=parsed.document_type,
        confidence=parsed.confidence,
        reasoning=parsed.reasoning,
        status="predicted",
    )


def parse_model_classification(raw: str) -> ModelClassification:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("The model returned malformed JSON.") from error
    try:
        return ModelClassification.model_validate(data)
    except ValidationError as error:
        message = "The model returned an invalid classification."
        details = error.errors()
        if details:
            detail = str(details[0].get("msg", "")).strip()
            if detail and "/" not in detail and "\\" not in detail:
                message = detail
        raise ValueError(message) from error


def request_ollama(text: str, system_prompt: Optional[str] = None) -> str:
    host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    model = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
    body = json.dumps(
        {
            "model": model,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": system_prompt or _system_prompt()},
                {"role": "user", "content": text[:8000]},
            ],
            "options": {"temperature": 0},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        host + "/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=OLLAMA_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise ValueError("The Ollama model is not available.") from error
        raise ValueError("Ollama is not available.") from error
    except Exception as error:
        raise ValueError("Ollama is not available.") from error

    message = payload.get("message") if isinstance(payload, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ValueError("The model returned malformed JSON.")
    return content


def _text_is_insufficient(text: str) -> bool:
    body = re.sub(r"\[Page \d+\]", "", text or "")
    return len("".join(body.split())) < MIN_CLASSIFICATION_CHARACTERS


def _system_prompt() -> str:
    categories = ", ".join(DOCUMENT_TYPES)
    return (
        "Classify the document into exactly one category: "
        + categories
        + ". "
        "Use marksheet_10 for Class 10 or Secondary School Examination marksheets. "
        "Use marksheet_12 for Class 12 or Senior School Certificate marksheets. "
        "Use resume for a curriculum vitae or work history. "
        "Return only JSON with document_type, confidence, and reasoning. "
        "confidence must be a decimal from 0 to 1, such as 0.82, not a percentage. "
        "confidence is an uncalibrated estimate, not a calibrated probability."
    )


def _public_message(error: Exception, fallback: str) -> str:
    message = " ".join(str(error).split()) or fallback
    if "/" in message or "\\" in message:
        return fallback
    return message[:500]
