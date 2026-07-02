from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import Epic


class EpicSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    projectId = serializers.CharField(source="project_id")
    requirementId = serializers.CharField(
        source="requirement_id", required=False, allow_blank=True
    )
    hierarchyId = serializers.CharField(source="hierarchy_id")
    startDate = serializers.DateField(
        source="start_date", required=False, allow_null=True
    )
    endDate = serializers.DateField(source="end_date", required=False, allow_null=True)
    assignedTeam = serializers.CharField(
        source="assigned_team", required=False, allow_blank=True
    )
    createdBy = serializers.CharField(source="created_by_id", read_only=True)
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True, read_only=True
    )

    class Meta:
        model = Epic
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "projectId",
            "requirementId",
            "hierarchyId",
            "name",
            "description",
            "color",
            "startDate",
            "endDate",
            "status",
            "progress",
            "assignedTeam",
            "createdBy",
            "createdByName",
        ]
