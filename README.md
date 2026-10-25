# Document Vault

Local-first desktop app for keeping personal documents on your computer, reading them, and asking questions about them.

PDF and image upload is stored locally. Selectable PDF text is extracted with PyMuPDF. Images and scanned PDFs are read with Tesseract OCR. Extracted text is classified locally with Ollama, then important fields are extracted for the confirmed document type. Verified fields can be saved to a personal profile. Uploaded text is also indexed locally for semantic search. Embeddings use a separate Ollama model:

```bash
ollama pull nomic-embed-text
```

The model name can be changed with `OLLAMA_EMBED_MODEL`. The chatbot answers questions from those indexed passages and shows the retrieved sources. The Tauri desktop shell will be added after the web version works.

## Architecture

The UI and the API are separate processes during development.

- `src/` is the React + TypeScript + Vite frontend.
- `backend/` is the FastAPI application. It owns SQLite and, later, files and AI.
- The UI calls the API at `http://127.0.0.1:8765`.
- SQLite is created at `backend/data/vault.db` the first time the API starts. Override the folder with `VAULT_DATA_DIR`.

```text
src/                 React pages and API client
backend/main.py      FastAPI app and /health
backend/routers/     Placeholder HTTP routes
backend/services/    Placeholder processing steps
backend/schema.sql   SQLite tables
```

## Frontend setup

From the repository root:

```bash
npm install
```

## Backend setup

Python 3.9 or newer is required. SQLite comes with Python, so it is not listed in `requirements.txt`.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows, activate the virtual environment with `.venv\Scripts\activate`.

## macOS OCR setup

`pytesseract` is only a Python wrapper. It does not install the Tesseract program. The Tesseract executable has to be on the machine before OCR can run.

1. Install Tesseract with Homebrew:

```bash
brew install tesseract
```

2. Verify the executable:

```bash
tesseract --version
```

3. Install the Python dependencies, including `pytesseract` and Pillow:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
```

## Run both during development

Use two terminals.

Terminal 1, API:

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8765
```

Terminal 2, UI:

```bash
npm run dev
```

Open the Vite URL, usually `http://127.0.0.1:5173`. The header shows `API ok` when the backend is reachable.

`GET /health` returns:

```json
{ "status": "ok" }
```

`POST /documents` stores a PDF or image and adds it to the vault. Profile edits, search, and chat still return placeholder JSON.
