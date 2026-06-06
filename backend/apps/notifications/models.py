from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel


class Notification(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="notifications"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    type = models.CharField(max_length=64)
    title = models.CharField(max_length=500)
    message = models.TextField()
    project_id = models.CharField(max_length=36, blank=True, default="")
    related_entity_id = models.CharField(max_length=36, blank=True, default="")
    related_entity_type = models.CharField(max_length=32, blank=True, default="")
    is_read = models.BooleanField(default=False)

    REALTIME_COLLECTION = "notifications"

    class Meta(TimestampedModel.Meta):
        indexes = [
            models.Index(fields=["user", "is_read"]),
            models.Index(fields=["workspace", "-created_at"]),
        ]
