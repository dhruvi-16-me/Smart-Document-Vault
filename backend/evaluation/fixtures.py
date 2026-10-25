"""Synthetic labelled documents for measuring OCR and field extraction.

Each fixture renders its own file, so the text and the expected answers live in one place.
Every document is fictional and marked as a synthetic test document.
"""
import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import docx
import fitz
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"
SYNTHETIC = "SYNTHETIC TEST DOCUMENT - NOT VALID FOR IDENTIFICATION"


@dataclass
class Expected:
    """One value the extractor should find. Alternatives cover equivalent spellings."""

    values: List[str]
    field_name: Optional[str] = None  # template fields only; generic fields match by value
    page: Optional[int] = None
    date_roles: Tuple[str, ...] = ()  # any of these roles is correct


@dataclass
class Fixture:
    name: str
    filename: str
    media_type: str
    document_type: str
    document_label: str
    pages: List[List[str]]
    expected: List[Expected]
    subjects: Dict[str, str] = field(default_factory=dict)
    render: Callable[["Fixture", Path], Path] = None  # type: ignore[assignment]
    damage: str = "none"


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


def _page_image(lines: List[str], width: int = 1700, size: int = 34) -> Image.Image:
    line_height = int(size * 1.7)
    image = Image.new("RGB", (width, max(1100, 120 + line_height * len(lines))), "white")
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(lines):
        draw.text((90, 80 + index * line_height), line, fill="black", font=_font(size))
    return image


def _damage(image: Image.Image, kind: str) -> Image.Image:
    if kind == "skew_blur_jpeg":
        image = image.rotate(2.5, expand=True, fillcolor="white", resample=Image.BICUBIC)
        image = image.filter(ImageFilter.GaussianBlur(1.2))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=30)
        return Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")
    if kind == "faded":
        image = ImageEnhance.Contrast(image).enhance(0.4)
        return ImageEnhance.Brightness(image).enhance(1.15)
    if kind == "rotated_90":
        return image.rotate(90, expand=True)
    if kind == "small_skew":
        return image.rotate(-1.5, expand=True, fillcolor="white", resample=Image.BICUBIC)
    if kind == "low_resolution":
        return image.resize((image.width // 3, image.height // 3), Image.BILINEAR)
    return image


def render_image(fixture: Fixture, folder: Path) -> Path:
    path = folder / fixture.filename
    frames = [_damage(_page_image(lines), fixture.damage) for lines in fixture.pages]
    if path.suffix in {".tif", ".tiff"}:
        frames[0].save(path, save_all=True, append_images=frames[1:], compression="tiff_lzw")
    elif path.suffix in {".jpg", ".jpeg"}:
        frames[0].save(path, quality=85)
    else:
        frames[0].save(path)
    return path


def render_text_pdf(fixture: Fixture, folder: Path) -> Path:
    path = folder / fixture.filename
    document = fitz.open()
    for lines in fixture.pages:
        page = document.new_page(width=595, height=842)
        page.insert_textbox(fitz.Rect(50, 50, 545, 800), "\n".join(lines), fontsize=9)
    document.save(path)
    document.close()
    return path


def render_docx(fixture: Fixture, folder: Path) -> Path:
    path = folder / fixture.filename
    document = docx.Document()
    for lines in fixture.pages:
        for line in lines:
            document.add_paragraph(line)
    document.save(path)
    return path


def ground_truth_text(fixture: Fixture) -> str:
    return "\n".join(line for lines in fixture.pages for line in lines)


_POLICY_TERMS = [
    "Section {n}. The insurer will indemnify the insured person for medically necessary "
    "hospitalisation expenses incurred during the policy period, subject to the sum insured, "
    "the applicable sub-limits, the waiting periods, and the exclusions stated in this schedule. "
    "Claims must be intimated within forty-eight hours of admission for emergencies and at least "
    "seventy-two hours before a planned admission. Pre-hospitalisation expenses for thirty days "
    "and post-hospitalisation expenses for sixty days are payable when the main claim is admitted."
]


def _policy_clauses(start: int, count: int) -> List[str]:
    return [_POLICY_TERMS[0].format(n=number) for number in range(start, start + count)]


FIXTURES: List[Fixture] = [
    Fixture(
        name="class12_marksheet_pdf",
        filename="class12_marksheet.pdf",
        media_type="application/pdf",
        document_type="marksheet_12",
        document_label="Class 12 marksheet",
        render=render_text_pdf,
        pages=[[
            "CENTRAL BOARD OF SECONDARY EDUCATION",
            "SENIOR SCHOOL CERTIFICATE EXAMINATION 2024",
            "STATEMENT OF MARKS",
            SYNTHETIC,
            "Candidate Name: ANANYA VERMA",
            "Mother's Name: SUNITA VERMA",
            "Father's Name: RAJESH VERMA",
            "Date of Birth: 14/08/2006",
            "Gender: Female",
            "Category: General",
            "Roll Number: 24156789",
            "School: Sunrise Public School, Rohini",
            "Subject | Marks Obtained | Maximum Marks",
            "English Core | 91 | 100",
            "Mathematics | 95 | 100",
            "Physics | 88 | 100",
            "Chemistry | 90 | 100",
            "Computer Science | 97 | 100",
            "Total Marks: 461 / 500",
            "Percentage: 92.2%",
            "Result: PASS",
        ]],
        expected=[
            Expected(["ANANYA VERMA"], "full_name", 1),
            Expected(["SUNITA VERMA"], "mothers_name", 1),
            Expected(["RAJESH VERMA"], "fathers_name", 1),
            Expected(["14/08/2006", "2006-08-14"], "date_of_birth", 1),
            Expected(["Female"], "gender", 1),
            Expected(["General"], "category", 1),
            Expected(["24156789"], "roll_number", 1),
            Expected(["Sunrise Public School, Rohini", "Sunrise Public School"], "school", 1),
            Expected(["CENTRAL BOARD OF SECONDARY EDUCATION"], "board", 1),
            Expected(["2024"], "passing_year", 1),
            Expected(["461 / 500", "461"], "total_marks", 1),
            Expected(["92.2%", "92.2"], "percentage", 1),
        ],
        subjects={
            "English Core": "91",
            "Mathematics": "95",
            "Physics": "88",
            "Chemistry": "90",
            "Computer Science": "97",
        },
    ),
    Fixture(
        name="class10_marksheet_scan",
        filename="class10_marksheet_scan.jpg",
        media_type="image/jpeg",
        document_type="marksheet_10",
        document_label="Class 10 marksheet",
        render=render_image,
        damage="skew_blur_jpeg",
        pages=[[
            "CENTRAL BOARD OF SECONDARY EDUCATION",
            "SECONDARY SCHOOL EXAMINATION 2022",
            "MARKS STATEMENT",
            SYNTHETIC,
            "Name of Candidate: ANANYA VERMA",
            "Mother's Name: SUNITA VERMA",
            "Father's Name: RAJESH VERMA",
            "Date of Birth: 14/08/2006",
            "Roll Number: 22134567",
            "School: Sunrise Public School, Rohini",
            "English: 89",
            "Hindi: 92",
            "Mathematics: 96",
            "Science: 94",
            "Social Science: 90",
            "CGPA: 9.4",
            "Result: PASS",
        ]],
        expected=[
            Expected(["ANANYA VERMA"], "full_name", 1),
            Expected(["SUNITA VERMA"], "mothers_name", 1),
            Expected(["RAJESH VERMA"], "fathers_name", 1),
            Expected(["14/08/2006", "2006-08-14"], "date_of_birth", 1),
            Expected(["22134567"], "roll_number", 1),
            Expected(["Sunrise Public School, Rohini", "Sunrise Public School"], "school", 1),
            Expected(["CENTRAL BOARD OF SECONDARY EDUCATION"], "board", 1),
            Expected(["2022"], "passing_year", 1),
            Expected(["9.4"], "cgpa", 1),
        ],
        subjects={
            "English": "89",
            "Hindi": "92",
            "Mathematics": "96",
            "Science": "94",
            "Social Science": "90",
        },
    ),
    Fixture(
        name="aadhaar_photo_rotated",
        filename="aadhaar_photo.png",
        media_type="image/png",
        document_type="aadhaar",
        document_label="Aadhaar card",
        render=render_image,
        damage="rotated_90",
        pages=[[
            "Government of India",
            "Unique Identification Authority of India",
            SYNTHETIC,
            "ANANYA VERMA",
            "DOB: 14/08/2006",
            "Female",
            "2345 6789 0124",
            "Address: D-14, Sector 7, Rohini, New Delhi 110085",
            "Aadhaar - Aam Aadmi ka Adhikar",
        ]],
        expected=[
            Expected(["ANANYA VERMA"], "full_name", 1),
            Expected(["14/08/2006", "2006-08-14"], "date_of_birth", 1),
            Expected(["Female"], "gender", 1),
            Expected(["2345 6789 0124", "234567890124"], "aadhaar_number", 1),
            Expected(
                ["D-14, Sector 7, Rohini, New Delhi 110085", "D-14, Sector 7, Rohini, New Delhi - 110085"],
                "address",
                1,
            ),
        ],
    ),
    Fixture(
        name="pan_card_low_resolution",
        filename="pan_card.png",
        media_type="image/png",
        document_type="pan",
        document_label="PAN card",
        render=render_image,
        damage="low_resolution",
        pages=[[
            "INCOME TAX DEPARTMENT",
            "GOVT. OF INDIA",
            "Permanent Account Number Card",
            SYNTHETIC,
            "ABCPV1234K",
            "Name: ANANYA VERMA",
            "Father's Name: RAJESH VERMA",
            "Date of Birth: 14/08/2006",
        ]],
        expected=[
            Expected(["ABCPV1234K"], "pan_number", 1),
            Expected(["ANANYA VERMA"], "full_name", 1),
            Expected(["RAJESH VERMA"], "fathers_name", 1),
            Expected(["14/08/2006", "2006-08-14"], "date_of_birth", 1),
        ],
    ),
    Fixture(
        name="driving_licence_faded",
        filename="driving_licence.jpg",
        media_type="image/jpeg",
        document_type="drivers_license",
        document_label="Driving licence",
        render=render_image,
        damage="faded",
        pages=[[
            "Indian Union Driving Licence",
            "Issued by Transport Department, Government of NCT of Delhi",
            SYNTHETIC,
            "Licence No: DL-0720230012345",
            "Name: ANANYA VERMA",
            "Son/Daughter/Wife of: RAJESH VERMA",
            "Date of Birth: 14-08-2006",
            "Date of Issue: 20-09-2024",
            "Valid Till (Non-Transport): 13-08-2044",
        ]],
        expected=[
            Expected(["ANANYA VERMA"], "full_name", 1),
            Expected(["DL-0720230012345"], "license_number", 1),
            Expected(["14-08-2006", "2006-08-14"], "date_of_birth", 1),
            Expected(["13-08-2044", "2044-08-13"], "expiry_date", 1, ("expires",)),
        ],
    ),
    Fixture(
        name="insurance_policy_long",
        filename="insurance_policy.pdf",
        media_type="application/pdf",
        document_type="insurance",
        document_label="Insurance policy",
        render=render_text_pdf,
        pages=[
            [
                "Example General Insurance Co. Ltd.",
                "Health Insurance Policy Schedule",
                SYNTHETIC,
                "Policy Number: P/211100/01/2026/004512",
                "Policyholder: Ananya Verma",
                "Sum Insured: INR 5,00,000",
            ]
            + _policy_clauses(1, 6),
            _policy_clauses(7, 8),
            _policy_clauses(15, 8),
            _policy_clauses(23, 6)
            + [
                "Period of Insurance: From 01/04/2026 To 31/03/2027",
                "Policy Expiry Date: 31/03/2027",
                "Authorised Signatory, Example General Insurance Co. Ltd.",
            ],
        ],
        expected=[
            Expected(["Ananya Verma"], "full_name", 1),
            Expected(["P/211100/01/2026/004512"], "policy_number", 1),
            Expected(["Example General Insurance Co. Ltd.", "Example General Insurance Co. Ltd"], "insurer", 1),
            Expected(["31/03/2027", "2027-03-31"], "expiry_date", 4, ("expires",)),
        ],
    ),
    Fixture(
        name="rent_agreement_tiff",
        filename="rent_agreement.tiff",
        media_type="image/tiff",
        document_type="rent_agreement",
        document_label="Rent agreement",
        render=render_image,
        damage="small_skew",
        pages=[
            [
                "RENT AGREEMENT",
                SYNTHETIC,
                "This agreement is made on 1 July 2026",
                "between the Landlord, Suresh Gupta,",
                "and the Tenant, Ananya Verma.",
                "Property: Flat 12, Pocket 3, Dwarka, New Delhi",
                "Monthly rent: INR 18,000",
            ],
            [
                "Security deposit: INR 36,000",
                "Lock-in period: 11 months",
                "This agreement ends on 30 June 2027.",
                "Signed by both parties in the presence of two witnesses.",
            ],
        ],
        expected=[
            Expected(["Suresh Gupta"], page=1),
            Expected(["Ananya Verma"], page=1),
            Expected(["Flat 12, Pocket 3, Dwarka, New Delhi"], page=1),
            Expected(["INR 18,000", "18,000", "18000"], page=1),
            Expected(["1 July 2026", "2026-07-01"], page=1, date_roles=("issued", "start")),
            Expected(["INR 36,000", "36,000", "36000"], page=2),
            Expected(["30 June 2027", "2027-06-30"], page=2, date_roles=("expires",)),
        ],
    ),
    Fixture(
        name="electricity_bill_sideways",
        filename="electricity_bill.png",
        media_type="image/png",
        document_type="electricity_bill",
        document_label="Electricity bill",
        render=render_image,
        damage="rotated_90",
        pages=[[
            "BSES Rajdhani Power Limited",
            "Electricity Bill",
            SYNTHETIC,
            "Consumer Name: Ananya Verma",
            "CA Number: 152478963",
            "Bill Date: 25/10/2026",
            "Bill Amount: INR 2,340",
            "Due Date: 15/11/2026",
        ]],
        expected=[
            Expected(["Ananya Verma"], page=1),
            Expected(["152478963"], page=1),
            Expected(["25/10/2026", "2026-10-25"], page=1, date_roles=("issued",)),
            Expected(["INR 2,340", "2,340", "2340"], page=1),
            Expected(["15/11/2026", "2026-11-15"], page=1, date_roles=("due",)),
        ],
    ),
    Fixture(
        name="offer_letter_docx",
        filename="offer_letter.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        document_type="offer_letter",
        document_label="Offer letter",
        render=render_docx,
        pages=[[
            "Example Technologies Pvt Ltd",
            "Offer Letter",
            SYNTHETIC,
            "Dear Ananya Verma,",
            "We are pleased to offer you the position of Software Engineering Intern.",
            "Stipend: INR 40,000 per month",
            "Joining date: 5 January 2027",
            "Please accept this offer by 15 December 2026.",
        ]],
        expected=[
            Expected(["Ananya Verma"]),
            Expected(["Example Technologies Pvt Ltd"]),
            Expected(["Software Engineering Intern"]),
            Expected(["INR 40,000 per month", "INR 40,000", "40,000"]),
            Expected(["5 January 2027", "2027-01-05"], date_roles=("start",)),
        ],
    ),
]
