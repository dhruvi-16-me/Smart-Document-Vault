# Document Vault

Local-first desktop app for keeping personal documents on your computer, reading them, and asking questions about them.

Any file can be uploaded and is stored locally. Text is read from these formats:

- PDF: selectable text with PyMuPDF, or Tesseract OCR for scans
- Images: PNG, JPG, WEBP, HEIC (iPhone photos), and multi-page TIFF, with Tesseract OCR. Photos are turned upright from their EXIF orientation first.
- Word (.docx), and text files (.txt, .md, .csv)

Other files, such as .zip or old .doc files, are kept as "stored only". They can still be given a type, tags, and notes. The format is detected from the file's bytes, so a PNG named .jpg is still read.

Document types are open. Common Indian documents (Aadhaar, PAN, passport, Class 10 and 12 marksheets) are recognised by pattern rules first. Everything else is classified locally with Ollama, which may name any type, such as "Rent agreement" or "Electricity bill", and puts it in a group (Identity, Education, Medical, Financial, Legal, Employment, Vehicle, Property, Other). You can change the type, group, tags, and notes on the document page.

Fields are then extracted. Known types use a template (marksheets include parents' names, date of birth, total marks, percentage, CGPA, and subject marks). Every other type gets each labelled value in the document, such as Landlord, Monthly rent, or Due date. Each field records its kind (name, date, amount, ID number, and so on), the page it came from, and, for dates, a role (issued, start, expires, due, renewal, birth) and a YYYY-MM-DD form. Long documents are read in full, in page-sized batches. A value is kept only if it appears in the document text.

OCR turns sideways scans upright and enlarges small images. Each OCR'd page gets a confidence score; pages under 85 are flagged on the document page so their values can be checked against the original. Verified fields can be saved to a personal profile. Uploaded text is also indexed locally for semantic search. Embeddings use a separate Ollama model:

```bash
ollama pull nomic-embed-text
```

The model name can be changed with `OLLAMA_EMBED_MODEL`. The chatbot answers questions from those indexed passages and shows the retrieved sources. The Tauri desktop shell will be added after the web version works.

## Evaluation

`backend/evaluation/` holds nine synthetic labelled documents (marksheets, ID cards, a long insurance policy, a rent agreement, a bill, an offer letter), several with scan damage. With Ollama running:

```bash
cd backend
.venv/bin/python -m evaluation.run --json evaluation/results/latest.json
```

It prints OCR character error rate, field recall and precision, subject marks recall, page accuracy, and date-role accuracy. `evaluation/results/` keeps the numbers from before and after the Phase 2 extraction work.

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

`POST /documents` stores any file and adds it to the vault. `PATCH /documents/{id}` changes its type, group, tags, or notes. `GET /documents/options` lists known types, custom types already in use, groups, and tags.
