from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import ActivityLog, SavedSearch


class ActivityLogSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    entityType = serializers.CharField(source="entity_type")
    entityId = serializers.CharField(source="entity_id")

    class Meta:
        model = ActivityLog
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "action",
            "entityType",
            "entityId",
            "changes",
            "metadata",
        ]


class SavedSearchSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")

    class Meta:
        model = SavedSearch
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "name",
            "query",
            "filters",
        ]
