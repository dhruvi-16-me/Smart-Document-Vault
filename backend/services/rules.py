"""Pattern rules that classify common Indian documents without the model.

Each rule needs a format check (number pattern, checksum, or MRZ) together with a heading
phrase, so a resume or form that only mentions a PAN or Class 12 does not match. When no
rule matches, the model decides.
"""
import re
from typing import Optional

from pydantic import BaseModel

RULE_CONFIDENCE = 0.95
ID_CARD_MAX_CHARACTERS = 4000
MARKSHEET_MAX_CHARACTERS = 6000

_VERHOEFF_MULTIPLY = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_VERHOEFF_PERMUTE = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)

_AADHAAR_NUMBER = re.compile(r"(?<!\d)([2-9]\d{3})\s?(\d{4})\s?(\d{4})(?!\d)")
_PAN_NUMBER = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
_PASSPORT_MRZ = re.compile(r"P[<«]IND[A-Z<«]{5,}")
_PASSPORT_NUMBER = re.compile(r"\b[A-Z]\d{7}\b")

_MARKS_WORDS = re.compile(
    r"statement of marks|marks statement|marks? ?sheet|marks obtained|maximum marks|grade sheet"
)
_NOT_A_MARKSHEET = re.compile(
    r"curriculum vitae|\bresume\b|work experience|admit card|hall ticket|application form"
)
_CLASS_12 = re.compile(
    r"senior school certificate|higher secondary|intermediate examination"
    r"|\bclass (?:xii|12)\b|\b12th\b"
)
_CLASS_10 = re.compile(
    r"(?<!senior )(?<!higher )secondary school (?:examination|certificate)"
    r"|matriculation|high school examination|\bclass (?:x|10)\b|\b10th\b"
)


class RuleMatch(BaseModel):
    document_type: str
    confidence: float = RULE_CONFIDENCE
    reasoning: str


def match_rules(text: str) -> Optional[RuleMatch]:
    body = " ".join(re.sub(r"\[Page \d+\]", " ", text or "").split())
    lowered = body.lower()
    for rule in (_aadhaar, _pan, _passport, _marksheet):
        match = rule(body, lowered)
        if match is not None:
            return match
    return None


def verhoeff_valid(number: str) -> bool:
    if not number.isdigit():
        return False
    check = 0
    for position, digit in enumerate(reversed(number)):
        check = _VERHOEFF_MULTIPLY[check][_VERHOEFF_PERMUTE[position % 8][int(digit)]]
    return check == 0


def _aadhaar(body: str, lowered: str) -> Optional[RuleMatch]:
    if len(body) > ID_CARD_MAX_CHARACTERS:
        return None
    if not ("aadhaar" in lowered or "unique identification authority" in lowered or "आधार" in body):
        return None
    for match in _AADHAAR_NUMBER.finditer(body):
        if verhoeff_valid("".join(match.groups())):
            return RuleMatch(
                document_type="aadhaar",
                reasoning="Found an Aadhaar heading and a 12-digit number with a valid Aadhaar checksum.",
            )
    return None


def _pan(body: str, lowered: str) -> Optional[RuleMatch]:
    if len(body) > ID_CARD_MAX_CHARACTERS:
        return None
    if "income tax department" not in lowered or "permanent account number" not in lowered:
        return None
    if not _PAN_NUMBER.search(body):
        return None
    return RuleMatch(
        document_type="pan",
        reasoning="Found the Income Tax Department and Permanent Account Number headings and a PAN-format number.",
    )


def _passport(body: str, lowered: str) -> Optional[RuleMatch]:
    if len(body) > ID_CARD_MAX_CHARACTERS:
        return None
    if _PASSPORT_MRZ.search(body.replace(" ", "")):
        return RuleMatch(
            document_type="passport",
            reasoning="Found an Indian passport machine-readable zone.",
        )
    if "republic of india" in lowered and "passport" in lowered and _PASSPORT_NUMBER.search(body):
        return RuleMatch(
            document_type="passport",
            reasoning="Found Republic of India and passport headings and a passport-format number.",
        )
    return None


def _marksheet(body: str, lowered: str) -> Optional[RuleMatch]:
    if len(body) > MARKSHEET_MAX_CHARACTERS:
        return None
    if not _MARKS_WORDS.search(lowered) or _NOT_A_MARKSHEET.search(lowered):
        return None
    class_12 = bool(_CLASS_12.search(lowered))
    class_10 = bool(_CLASS_10.search(lowered))
    if class_12 == class_10:
        return None
    if class_12:
        return RuleMatch(
            document_type="marksheet_12",
            reasoning="Found a marksheet heading for a Class 12 or Senior School examination.",
        )
    return RuleMatch(
        document_type="marksheet_10",
        reasoning="Found a marksheet heading for a Class 10 or Secondary School examination.",
    )
