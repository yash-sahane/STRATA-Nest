from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

EPIC_STATUS = [("TODO", "Todo"), ("IN_PROGRESS", "In Progress"), ("DONE", "Done")]


class Epic(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="epics"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="epics"
    )
    requirement_id = models.CharField(max_length=36, blank=True, default="")
    hierarchy_id = models.CharField(max_length=100)
    name = models.CharField(max_length=500)
    description = models.TextField(blank=True, default="")
    color = models.CharField(max_length=50, blank=True, default="")
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=EPIC_STATUS, default="TODO")
    progress = models.PositiveIntegerField(default=0)
    assigned_team = models.CharField(max_length=255, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_epics"
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")

    REALTIME_COLLECTION = "epics"
