from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Optional, List
from pydantic import BaseModel

from learning.api.auth import get_current_owner, AuthenticatedOwner
from learning.domain.contracts import (
    PendingTaskRecord,
    PendingTaskType,
    PendingTaskStatus,
    ImportSummaryResponse,
    SourceDocumentRecord,
)
from learning.repositories.sources import (
    get_pending_tasks,
    get_source_document,
)
from learning.imports.importer import import_all_chats_from_directory

router = APIRouter(tags=["Sources & Ingestion"])


class ImportRequestInput(BaseModel):
    downloads_dir: Optional[str] = "C:/Users/darsh/Downloads"


@router.post(
    "/api/imports/chats",
    response_model=ImportSummaryResponse,
    status_code=status.HTTP_200_OK,
)
async def trigger_chat_import(
    body: Optional[ImportRequestInput] = None,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ImportSummaryResponse:
    """
    Triggers idempotent ingestion of historical chat exports from downloads directory.
    Verified by B05-AC1.
    """
    path = body.downloads_dir if body and body.downloads_dir else "C:/Users/darsh/Downloads"
    res = import_all_chats_from_directory(owner_id=owner.owner_id, directory_path=path)
    return ImportSummaryResponse(
        owner_id=owner.owner_id,
        tracks_imported=res["tracks"],
        documents_ingested=len(res["tracks"]),
        turns_extracted=res["total_turns"],
        artifacts_created=0,
        observations_staged=res["total_observations_staged"],
        pending_tasks_created=res["total_pending_tasks"],
        warnings=res.get("warnings", []),
    )


@router.get(
    "/api/pending-tasks",
    response_model=List[PendingTaskRecord],
)
async def list_pending_tasks(
    classroom_id: Optional[str] = None,
    task_type: Optional[PendingTaskType] = None,
    task_status: Optional[PendingTaskStatus] = None,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[PendingTaskRecord]:
    """
    Returns preserved pending tasks across tracks (Two Pointers, Prefix Sums, CS Follow-ups, ML Regression).
    Verified by B05-AC3.
    """
    return get_pending_tasks(
        owner_id=owner.owner_id,
        classroom_id=classroom_id,
        task_type=task_type,
        status=task_status,
    )
