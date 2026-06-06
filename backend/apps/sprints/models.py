from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

SPRINT_STATUS = [
    ("PLANNING", "Planning"),
    ("ACTIVE", "Active"),
    ("COMPLETED", "Completed"),
]


class Sprint(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="sprints"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="sprints"
    )
    name = models.CharField(max_length=255)
    goal = models.TextField(blank=True, default="")
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=SPRINT_STATUS, default="PLANNING")
    retrospective_notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_sprints",
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")

    REALTIME_COLLECTION = "sprints"

    class Meta(TimestampedModel.Meta):
        indexes = [models.Index(fields=["project", "status"])]


class Retrospective(TimestampedModel):
    sprint = models.ForeignKey(
        Sprint, on_delete=models.CASCADE, related_name="retrospectives"
    )
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="retrospectives"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="retrospectives"
    )
    went_well = models.JSONField(default=list)
    needs_improvement = models.JSONField(default=list)
    action_items = models.JSONField(default=list)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_retros",
    )

    REALTIME_COLLECTION = "retrospectives"
