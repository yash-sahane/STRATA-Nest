"""POST /api/v1/bulk-save/ — atomic batch creation of CR → Epic → FR → Task.

The frontend AI generator posts `generated`, `projectId`, `projectCode`,
`workspaceId`, and `userId`; this endpoint applies the hierarchy-id rules and
creates the full project tree in one transaction.
"""

from __future__ import annotations

import re

from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.epics.models import Epic
from apps.projects.models import Project
from apps.requirements.models import ClientRequirement, FunctionalRequirement
from apps.tasks.models import Task
from apps.workspaces.models import Workspace, WorkspaceMember

_TECHNICAL_KEYWORDS = {
    "api",
    "database",
    "code",
    "implementation",
    "backend",
    "frontend",
    "server",
    "endpoint",
    "query",
    "schema",
    "migration",
    "deploy",
    "infrastructure",
    "architecture",
    "integration",
    "service",
    "microservice",
    "rest",
    "graphql",
    "websocket",
    "authentication",
    "authorization",
    "encryption",
    "security",
    "cache",
    "performance",
    "optimization",
}


def _extract_chars(text: str, count: int) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"[^a-zA-Z]", "", text)
    return cleaned[:count].upper()


def _fr_type(fr: dict) -> str:
    if (fr.get("type") or "").upper() == "TECHNICAL":
        return "TECHNICAL"
    blob = f"{fr.get('title', '').lower()} {fr.get('description', '').lower()}"
    return "TECHNICAL" if any(k in blob for k in _TECHNICAL_KEYWORDS) else "FUNCTIONAL"


class BulkSaveView(APIView):
    """Create CRs → Epics → FRs → Tasks transactionally."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        body = request.data or {}
        project_id = body.get("projectId")
        project_code = body.get("projectCode") or "PROJ"
        workspace_id = body.get("workspaceId")
        user_id = body.get("userId") or str(request.user.id)
        generated = body.get("generated") or {}

        if not project_id or not workspace_id:
            return Response(
                {"message": "projectId and workspaceId are required"}, status=400
            )

        # Authorisation: caller must be a member of this workspace.
        if not WorkspaceMember.objects.filter(
            workspace_id=workspace_id, user_id=request.user.id
        ).exists():
            if not (
                request.user.is_superuser
                or getattr(request.user, "is_admin_flag", False)
            ):
                return Response({"message": "Not a workspace member"}, status=403)

        try:
            project = Project.objects.get(pk=project_id)
        except Project.DoesNotExist:
            return Response({"message": "Project not found"}, status=404)
        try:
            workspace = Workspace.objects.get(pk=workspace_id)
        except Workspace.DoesNotExist:
            return Response({"message": "Workspace not found"}, status=404)

        client_name = getattr(project, "client_name", "") or "Client"
        user_name = getattr(request.user, "name", "") or ""

        result = {
            "clientRequirements": [],
            "functionalRequirements": [],
            "epics": [],
            "tasks": [],
        }

        with transaction.atomic():
            # ---- 1. Client Requirements -----------------------------
            for i, cr in enumerate(generated.get("clientRequirements") or []):
                cr_code = _extract_chars(cr.get("title", ""), 3) or "CR"
                hierarchy = f"{project_code}-{cr_code}-{i + 1:02d}"
                doc = ClientRequirement.objects.create(
                    workspace=workspace,
                    project=project,
                    title=cr.get("title", "")[:500],
                    description=cr.get("description", ""),
                    client_name=client_name,
                    priority=(cr.get("priority") or "MEDIUM").upper(),
                    status="DRAFT",
                    attachments=[],
                    created_by_id=user_id,
                    created_by_name=user_name,
                )
                result["clientRequirements"].append(
                    {"id": doc.id, "hierarchyId": hierarchy}
                )

            # ---- 2. Epics (linked round-robin to CRs) ---------------
            epic_seq_start = Epic.objects.filter(project=project).count() + 1
            for i, epic in enumerate(generated.get("epics") or []):
                linked_cr = (
                    result["clientRequirements"][i % len(result["clientRequirements"])]
                    if result["clientRequirements"]
                    else None
                )
                cr_code = linked_cr["hierarchyId"].split("-")[1] if linked_cr else "CR"
                epic_code = _extract_chars(epic.get("name", ""), 3) or "EP"
                hierarchy = (
                    f"{project_code}-{cr_code}-{epic_code}-{epic_seq_start + i:02d}"
                )
                if Epic.objects.filter(
                    project=project, hierarchy_id=hierarchy
                ).exists():
                    continue
                doc = Epic.objects.create(
                    workspace=workspace,
                    project=project,
                    requirement_id=(linked_cr or {}).get("id", ""),
                    hierarchy_id=hierarchy,
                    name=epic.get("name", "")[:500],
                    description=epic.get("description", ""),
                    color=epic.get("color", "#3b82f6"),
                    start_date=epic.get("startDate") or None,
                    end_date=epic.get("endDate") or None,
                    status="TODO",
                    progress=0,
                    created_by_id=user_id,
                    created_by_name=user_name,
                )
                result["epics"].append(
                    {
                        "id": doc.id,
                        "hierarchyId": hierarchy,
                        "crCode": cr_code,
                        "requirementId": (linked_cr or {}).get("id", ""),
                    }
                )

            # ---- 3. Functional Requirements -------------------------
            fr_seq_start = (
                FunctionalRequirement.objects.filter(project=project).count() + 1
            )
            fr_id_map: dict[str, str] = {}
            top_level = [
                fr
                for fr in (generated.get("functionalRequirements") or [])
                if not fr.get("parentId")
            ]
            for i, fr in enumerate(top_level):
                if result["epics"]:
                    linked = result["epics"][i % len(result["epics"])]
                else:
                    linked = None
                cr_code = linked["hierarchyId"].split("-")[1] if linked else "CR"
                epic_code = linked["hierarchyId"].split("-")[2] if linked else "EP"
                fr_code = _extract_chars(fr.get("title", ""), 3) or "FR"
                hierarchy = f"{project_code}-{cr_code}-{epic_code}-{fr_code}-{fr_seq_start + i:02d}"
                if FunctionalRequirement.objects.filter(
                    project=project, hierarchy_id=hierarchy
                ).exists():
                    continue
                doc = FunctionalRequirement.objects.create(
                    workspace=workspace,
                    project=project,
                    hierarchy_id=hierarchy,
                    epic_id=(linked or {}).get("id", ""),
                    client_requirement_id=(linked or {}).get("requirementId", "")
                    or (
                        result["clientRequirements"][0]["id"]
                        if result["clientRequirements"]
                        else ""
                    ),
                    title=fr.get("title", "")[:500],
                    description=fr.get("description", ""),
                    complexity=(fr.get("complexity") or "MEDIUM").upper(),
                    status="DRAFT",
                    reusable=False,
                    tags="",
                    linked_project_ids="",
                    created_by_id=user_id,
                    created_by_name=user_name,
                )
                # Map by original index so child FRs can lookup parent
                original_idx = (generated.get("functionalRequirements") or []).index(fr)
                fr_id_map[f"fr-{original_idx}"] = doc.id
                result["functionalRequirements"].append(
                    {
                        "id": doc.id,
                        "hierarchyId": hierarchy,
                        "epicId": (linked or {}).get("id", ""),
                    }
                )

            # Children
            for fr in generated.get("functionalRequirements") or []:
                if not fr.get("parentId"):
                    continue
                parent_db_id = fr_id_map.get(fr["parentId"])
                if not parent_db_id:
                    continue
                parent = FunctionalRequirement.objects.get(pk=parent_db_id)
                sibling_count = FunctionalRequirement.objects.filter(
                    project=project,
                    hierarchy_id__startswith=parent.hierarchy_id + ".",
                ).count()
                child_hierarchy = f"{parent.hierarchy_id}.{sibling_count + 1:02d}"
                if FunctionalRequirement.objects.filter(
                    project=project, hierarchy_id=child_hierarchy
                ).exists():
                    continue
                doc = FunctionalRequirement.objects.create(
                    workspace=workspace,
                    project=project,
                    hierarchy_id=child_hierarchy,
                    epic_id=parent.epic_id,
                    client_requirement_id=parent.client_requirement_id,
                    title=fr.get("title", "")[:500],
                    description=fr.get("description", ""),
                    complexity=(fr.get("complexity") or "MEDIUM").upper(),
                    status="DRAFT",
                    reusable=False,
                    created_by_id=user_id,
                    created_by_name=user_name,
                )
                result["functionalRequirements"].append(
                    {
                        "id": doc.id,
                        "hierarchyId": child_hierarchy,
                        "epicId": parent.epic_id,
                    }
                )

            # ---- 4. Tasks -------------------------------------------
            task_seq_start = Task.objects.filter(project=project).count() + 1
            for i, task in enumerate(generated.get("tasks") or []):
                if result["functionalRequirements"]:
                    linked_fr = result["functionalRequirements"][
                        i % len(result["functionalRequirements"])
                    ]
                    fr_id = linked_fr["id"]
                    epic_id = linked_fr.get("epicId", "")
                else:
                    fr_id, epic_id = "", ""
                task_code = _extract_chars(task.get("title", ""), 3) or "TSK"
                hierarchy = f"{project_code}-{task_code}-{task_seq_start + i:02d}"
                doc = Task.objects.create(
                    workspace=workspace,
                    project=project,
                    hierarchy_id=hierarchy,
                    functional_requirement_id=fr_id,
                    epic_id=epic_id,
                    title=task.get("title", "")[:500],
                    description=task.get("description", ""),
                    status="BACKLOG",
                    priority=(task.get("priority") or "MEDIUM").upper(),
                    created_by_id=user_id,
                    created_by_name=user_name,
                    estimated_hours=task.get("estimatedHours"),
                )
                result["tasks"].append({"id": doc.id, "hierarchyId": hierarchy})

        return Response({"success": True, **result}, status=status.HTTP_201_CREATED)
