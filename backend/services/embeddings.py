import json
import math
import os
import urllib.error
import urllib.request
from typing import List

EMBED_TIMEOUT_SECONDS = 120


def embed_model() -> str:
    return os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")


def embed_texts(texts: list) -> list:
    """Return one embedding vector for each text. Uses the embedding model, not the chat model."""
    if not texts:
        return []
    host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    body = json.dumps({"model": embed_model(), "input": list(texts)}).encode("utf-8")
    request = urllib.request.Request(
        host + "/api/embed",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=EMBED_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise ValueError(
                "The embedding model is not available. Install it with: ollama pull nomic-embed-text"
            ) from error
        raise ValueError("Ollama is not available.") from error
    except Exception as error:
        raise ValueError("Ollama is not available.") from error

    vectors = payload.get("embeddings") if isinstance(payload, dict) else None
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        raise ValueError("The embedding model returned an unexpected response.")
    return [_validate_vector(vector) for vector in vectors]


def _validate_vector(vector: object) -> List[float]:
    if not isinstance(vector, list) or not vector:
        raise ValueError("The embedding model returned an unexpected response.")
    values = []
    for item in vector:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError("The embedding model returned an unexpected response.")
        number = float(item)
        if not math.isfinite(number):
            raise ValueError("The embedding model returned an unexpected response.")
        values.append(number)
    return values
