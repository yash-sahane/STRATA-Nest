from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import Notification


class NotificationSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    projectId = serializers.CharField(
        source="project_id", required=False, allow_blank=True
    )
    relatedEntityId = serializers.CharField(
        source="related_entity_id", required=False, allow_blank=True
    )
    relatedEntityType = serializers.CharField(
        source="related_entity_type", required=False, allow_blank=True
    )
    isRead = serializers.BooleanField(source="is_read", required=False)

    class Meta:
        model = Notification
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "type",
            "title",
            "message",
            "projectId",
            "relatedEntityId",
            "relatedEntityType",
            "isRead",
        ]
