from fastapi import APIRouter, HTTPException

from models import (
    ImportableFieldsResponse,
    ProfileField,
    ProfileFieldCreate,
    ProfileFieldPatch,
    ProfileImportRequest,
    ProfileResolveRequest,
    ProfileResponse,
)
from services.profile import (
    ProfileConflict as ServiceConflict,
    add_manual_field,
    import_verified_field,
    list_importable_fields,
    list_profile,
    remove_field,
    resolve_conflict,
    update_field,
)

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=ProfileResponse)
def get_profile() -> ProfileResponse:
    return ProfileResponse(fields=[field.model_dump() for field in list_profile()])


@router.post("/fields", response_model=ProfileField)
def create_profile_field(body: ProfileFieldCreate):
    try:
        result = add_manual_field(body.field_name, body.field_value)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if isinstance(result, ServiceConflict):
        raise HTTPException(status_code=409, detail=result.model_dump())
    return result


@router.patch("/fields/{field_id}", response_model=ProfileField)
def patch_profile_field(field_id: int, body: ProfileFieldPatch) -> ProfileField:
    try:
        return update_field(field_id, body.field_value)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.delete("/fields/{field_id}")
def delete_profile_field(field_id: int) -> dict:
    try:
        remove_field(field_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"id": field_id, "deleted": True}


@router.get("/importable-fields", response_model=ImportableFieldsResponse)
def get_importable_fields() -> ImportableFieldsResponse:
    return ImportableFieldsResponse(
        fields=[field.model_dump() for field in list_importable_fields()]
    )


@router.post("/import", response_model=ProfileField)
def import_profile_field(body: ProfileImportRequest):
    try:
        result = import_verified_field(body.document_id, body.document_field_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if isinstance(result, ServiceConflict):
        raise HTTPException(status_code=409, detail=result.model_dump())
    return result


@router.post("/conflicts/resolve", response_model=ProfileField)
def resolve_profile_conflict(body: ProfileResolveRequest) -> ProfileField:
    try:
        result = resolve_conflict(
            body.action.strip().lower(),
            body.document_id,
            body.document_field_id,
            body.field_name,
            body.field_value,
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return result
