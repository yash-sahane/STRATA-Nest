from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import UploadedFile


class UploadedFileSerializer(NativeModelSerializer):
    mimeType = serializers.CharField(
        source="mime_type", required=False, allow_blank=True
    )
    workspaceId = serializers.CharField(
        source="workspace_id", required=False, allow_blank=True
    )
    projectId = serializers.CharField(
        source="project_id", required=False, allow_blank=True
    )
    uploadedBy = serializers.CharField(
        source="uploaded_by_id", read_only=True, allow_null=True
    )
    bucketId = serializers.CharField(source="bucket", required=False, allow_blank=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = UploadedFile
        fields = [
            "id",
            "created_at",
            "updated_at",
            "name",
            "mimeType",
            "size",
            "workspaceId",
            "projectId",
            "uploadedBy",
            "bucketId",
            "url",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "size",
            "uploadedBy",
            "url",
        ]

    def get_url(self, obj):
        try:
            return obj.file.url
        except ValueError:
            return ""
