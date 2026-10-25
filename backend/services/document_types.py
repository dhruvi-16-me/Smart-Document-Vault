import re
from typing import Optional, Tuple

# Types with a field template. Any other type is allowed and stored as a slug of its name.
KNOWN_TYPES = {
    "aadhaar": ("Aadhaar card", "identity"),
    "pan": ("PAN card", "identity"),
    "passport": ("Passport", "identity"),
    "drivers_license": ("Driving licence", "identity"),
    "marksheet_10": ("Class 10 marksheet", "education"),
    "marksheet_12": ("Class 12 marksheet", "education"),
    "degree_certificate": ("Degree certificate", "education"),
    "medical": ("Medical record", "medical"),
    "insurance": ("Insurance policy", "financial"),
    "resume": ("Resume", "employment"),
    "other": ("Other document", "other"),
}

DOCUMENT_GROUPS = {
    "identity": "Identity",
    "education": "Education",
    "medical": "Medical",
    "financial": "Financial",
    "legal": "Legal",
    "employment": "Employment",
    "vehicle": "Vehicle",
    "property": "Property",
    "other": "Other",
}

# Other spellings that should land on a known type.
_ALIASES = {
    "aadhar": "aadhaar",
    "aadhar_card": "aadhaar",
    "aadhaar_letter": "aadhaar",
    "pan_number": "pan",
    "class_10_marksheet": "marksheet_10",
    "class_x_marksheet": "marksheet_10",
    "class_12_marksheet": "marksheet_12",
    "class_xii_marksheet": "marksheet_12",
    "driving_license": "drivers_license",
    "drivers_licence": "drivers_license",
    "cv": "resume",
    "curriculum_vitae": "resume",
}

MAX_LABEL_LENGTH = 80


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:60]


for _key, (_label, _group) in KNOWN_TYPES.items():
    _ALIASES.setdefault(slugify(_label), _key)


def resolve_type(
    raw_type: str, raw_group: Optional[str] = None
) -> Tuple[str, str, str]:
    """Return (type key, display label, group) for any type name.

    Known types keep their key, label, and group. Anything else becomes a custom type
    whose key is a slug of the name. An unknown or missing group falls back to other.
    """
    label = " ".join((raw_type or "").replace("_", " ").split())[:MAX_LABEL_LENGTH]
    slug = slugify(label)
    if not slug:
        raise ValueError("A document type is required.")
    known = slug if slug in KNOWN_TYPES else _ALIASES.get(slug)
    if known:
        known_label, known_group = KNOWN_TYPES[known]
        return known, known_label, normalize_group(raw_group) or known_group
    return slug, label[0].upper() + label[1:], normalize_group(raw_group) or "other"


def normalize_group(value: Optional[str]) -> Optional[str]:
    """Return a group key, also accepting close forms such as "Legal documents"."""
    if not value:
        return None
    key = slugify(value)
    if key in DOCUMENT_GROUPS:
        return key
    return next((part for part in key.split("_") if part in DOCUMENT_GROUPS), None)
