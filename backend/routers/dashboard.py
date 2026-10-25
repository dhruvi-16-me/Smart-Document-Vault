from datetime import date

from fastapi import APIRouter

from database import connect
from models import DashboardResponse, UpcomingDate

router = APIRouter(tags=["dashboard"])

# Dates worth a reminder; issue and birth dates are history, not things to act on.
UPCOMING_ROLES = ("expires", "due", "renewal")
# Show dates that passed recently as well, so an expired document is not missed.
RECENT_PAST_DAYS = 90
MAX_UPCOMING = 8


@router.get("/dashboard", response_model=DashboardResponse)
def dashboard() -> DashboardResponse:
    """Expiry, due, and renewal dates read from documents, soonest first."""
    connection = connect()
    try:
        rows = connection.execute(
            """
            SELECT document_fields.document_id, document_fields.name, document_fields.label,
                   document_fields.date_role, document_fields.normalized_value,
                   document_fields.page_number, document_fields.verification_status,
                   documents.filename, documents.document_label, documents.document_group
            FROM document_fields
            JOIN documents ON documents.id = document_fields.document_id
            WHERE document_fields.date_role IN ({})
              AND document_fields.normalized_value IS NOT NULL
            ORDER BY document_fields.normalized_value
            """.format(", ".join("?" for _ in UPCOMING_ROLES)),
            UPCOMING_ROLES,
        ).fetchall()
    finally:
        connection.close()

    today = date.today()
    upcoming = []
    for row in rows:
        try:
            when = date.fromisoformat(row["normalized_value"])
        except ValueError:
            continue
        days_left = (when - today).days
        if days_left < -RECENT_PAST_DAYS:
            continue
        upcoming.append(
            UpcomingDate(
                document_id=row["document_id"],
                filename=row["filename"],
                document_label=row["document_label"],
                document_group=row["document_group"],
                field_label=row["label"] or row["name"].replace("_", " ").capitalize(),
                date_role=row["date_role"],
                date=row["normalized_value"],
                days_left=days_left,
                page_number=row["page_number"],
                verified=row["verification_status"] == "verified",
            )
        )
    return DashboardResponse(upcoming=upcoming[:MAX_UPCOMING])
