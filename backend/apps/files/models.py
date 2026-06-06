"""File uploads.

The frontend file client talks to:
  POST   /api/v1/files/            multipart upload
  GET    /api/v1/files/{id}/       metadata
  DELETE /api/v1/files/{id}/       remove
  GET    /api/v1/files/{id}/preview/
  GET    /api/v1/files/{id}/view/
  GET    /api/v1/files/{id}/download/
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel


def _upload_path(instance: "UploadedFile", filename: str) -> str:
    ws = instance.workspace_id or "_none"
    return f"uploads/{ws}/{instance.id}/{filename}"


class UploadedFile(TimestampedModel):
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to=_upload_path, max_length=500)
    mime_type = models.CharField(max_length=128, blank=True, default="")
    size = models.BigIntegerField(default=0)
    workspace_id = models.CharField(max_length=36, blank=True, default="")
    project_id = models.CharField(max_length=36, blank=True, default="")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="uploaded_files",
    )
    bucket = models.CharField(max_length=64, blank=True, default="default")

    REALTIME_COLLECTION = "files"

    def __str__(self) -> str:
        return self.name
