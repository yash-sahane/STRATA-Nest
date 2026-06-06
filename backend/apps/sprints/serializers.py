from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import Retrospective, Sprint


class SprintSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    projectId = serializers.CharField(source="project_id")
    startDate = serializers.DateField(source="start_date")
    endDate = serializers.DateField(source="end_date")
    retrospectiveNotes = serializers.CharField(
        source="retrospective_notes", required=False, allow_blank=True
    )
    createdBy = serializers.CharField(source="created_by_id")
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True
    )

    class Meta:
        model = Sprint
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "projectId",
            "name",
            "goal",
            "startDate",
            "endDate",
            "status",
            "retrospectiveNotes",
            "createdBy",
            "createdByName",
        ]


class RetrospectiveSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    projectId = serializers.CharField(source="project_id")
    sprintId = serializers.CharField(source="sprint_id")
    wentWell = serializers.JSONField(source="went_well", required=False)
    needsImprovement = serializers.JSONField(source="needs_improvement", required=False)
    actionItems = serializers.JSONField(source="action_items", required=False)
    createdBy = serializers.CharField(source="created_by_id")

    class Meta:
        model = Retrospective
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "projectId",
            "sprintId",
            "wentWell",
            "needsImprovement",
            "actionItems",
            "createdBy",
        ]
