from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import Project


class ProjectSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    shortCode = serializers.CharField(source="short_code")
    clientName = serializers.CharField(
        source="client_name", required=False, allow_blank=True
    )
    ownerId = serializers.CharField(source="owner_id")
    createdBy = serializers.CharField(source="created_by_id")
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True
    )
    memberIds = serializers.JSONField(source="member_ids", required=False)
    settings = serializers.JSONField(source="project_settings", required=False)
    startDate = serializers.DateField(
        source="start_date", required=False, allow_null=True
    )
    endDate = serializers.DateField(source="end_date", required=False, allow_null=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "name",
            "shortCode",
            "description",
            "clientName",
            "logo",
            "color",
            "methodology",
            "status",
            "archived",
            "startDate",
            "endDate",
            "ownerId",
            "createdBy",
            "createdByName",
            "memberIds",
            "settings",
        ]
