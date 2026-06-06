from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel


class ActivityLog(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="activity_logs"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="activity_logs"
    )
    action = models.CharField(max_length=64)
    entity_type = models.CharField(max_length=32)
    entity_id = models.CharField(max_length=36)
    changes = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    REALTIME_COLLECTION = "activity_logs"

    class Meta(TimestampedModel.Meta):
        indexes = [
            models.Index(fields=["workspace", "-created_at"]),
            models.Index(fields=["entity_type", "entity_id"]),
        ]


class SavedSearch(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="saved_searches"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_searches",
    )
    name = models.CharField(max_length=255)
    query = models.TextField()
    filters = models.JSONField(default=dict, blank=True)

    REALTIME_COLLECTION = "saved_searches"
