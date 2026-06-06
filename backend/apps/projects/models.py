"""Project model.

Mirrors frontend `Project` interface (src/types/index.ts).
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

PROJECT_STATUS = [
    ("PLANNING", "Planning"),
    ("ACTIVE", "Active"),
    ("ON_HOLD", "On Hold"),
    ("COMPLETED", "Completed"),
    ("ARCHIVED", "Archived"),
]


class Project(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="projects"
    )
    name = models.CharField(max_length=255)
    short_code = models.CharField(max_length=10)
    description = models.TextField(blank=True, default="")
    client_name = models.CharField(max_length=255, blank=True, default="")
    logo = models.URLField(max_length=500, blank=True, default="")
    color = models.CharField(max_length=50, blank=True, default="")
    methodology = models.CharField(max_length=20, default="SCRUM")
    status = models.CharField(max_length=20, choices=PROJECT_STATUS, default="PLANNING")
    archived = models.BooleanField(default=False)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_projects",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_projects",
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")
    member_ids = models.JSONField(default=list)
    project_settings = models.JSONField(
        default=dict
    )  # `settings` is a reserved attr name

    REALTIME_COLLECTION = "projects"

    class Meta(TimestampedModel.Meta):
        indexes = [models.Index(fields=["workspace", "status"])]

    def __str__(self) -> str:
        return f"{self.short_code} — {self.name}"
