from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

REQUIREMENT_PRIORITY = [
    ("LOW", "Low"),
    ("MEDIUM", "Medium"),
    ("HIGH", "High"),
    ("CRITICAL", "Critical"),
]
REQUIREMENT_STATUS = [
    ("DRAFT", "Draft"),
    ("SUBMITTED", "Submitted"),
    ("APPROVED", "Approved"),
    ("IN_PROGRESS", "In Progress"),
    ("COMPLETED", "Completed"),
    ("ARCHIVED", "Archived"),
]
FR_STATUS = [
    ("DRAFT", "Draft"),
    ("REVIEW", "Review"),
    ("APPROVED", "Approved"),
    ("IMPLEMENTED", "Implemented"),
    ("TESTED", "Tested"),
    ("DEPLOYED", "Deployed"),
]
FR_COMPLEXITY = [
    ("LOW", "Low"),
    ("MEDIUM", "Medium"),
    ("HIGH", "High"),
    ("VERY_HIGH", "Very High"),
]


class ClientRequirement(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace",
        on_delete=models.CASCADE,
        related_name="client_requirements",
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="client_requirements"
    )
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True, default="")
    client_name = models.CharField(max_length=255, blank=True, default="")
    priority = models.CharField(
        max_length=20, choices=REQUIREMENT_PRIORITY, default="MEDIUM"
    )
    status = models.CharField(
        max_length=20, choices=REQUIREMENT_STATUS, default="DRAFT"
    )
    attachments = models.JSONField(default=list)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_client_reqs",
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")

    REALTIME_COLLECTION = "client_requirements"


class FunctionalRequirement(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace",
        on_delete=models.CASCADE,
        related_name="functional_requirements",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="functional_requirements",
    )
    hierarchy_id = models.CharField(max_length=100)
    epic_id = models.CharField(max_length=36, blank=True, default="")
    sprint_id = models.CharField(max_length=36, blank=True, default="")
    client_requirement_id = models.CharField(max_length=36, blank=True, default="")
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True, default="")
    complexity = models.CharField(
        max_length=20, choices=FR_COMPLEXITY, default="MEDIUM"
    )
    priority = models.CharField(
        max_length=20, choices=REQUIREMENT_PRIORITY, blank=True, default=""
    )
    status = models.CharField(max_length=20, choices=FR_STATUS, default="DRAFT")
    progress = models.PositiveIntegerField(default=0)
    reusable = models.BooleanField(default=False)
    assigned_to = models.JSONField(default=list)
    assigned_to_names = models.JSONField(default=list)
    tags = models.TextField(blank=True, default="")
    linked_project_ids = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_frs"
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")

    REALTIME_COLLECTION = "functional_requirements"

    class Meta(TimestampedModel.Meta):
        indexes = [
            models.Index(fields=["project", "epic_id"]),
            models.Index(fields=["hierarchy_id"]),
        ]
