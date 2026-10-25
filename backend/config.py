import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("VAULT_DATA_DIR", BACKEND_DIR / "data"))
DATABASE_PATH = DATA_DIR / "vault.db"

API_HOST = "127.0.0.1"
API_PORT = 8765
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
