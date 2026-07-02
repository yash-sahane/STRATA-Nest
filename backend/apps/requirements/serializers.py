from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import ClientRequirement, FunctionalRequirement


class ClientRequirementSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    projectId = serializers.CharField(source="project_id")
    clientName = serializers.CharField(
        source="client_name", required=False, allow_blank=True
    )
    createdBy = serializers.CharField(source="created_by_id", read_only=True)
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True, read_only=True
    )

    class Meta:
        model = ClientRequirement
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "projectId",
            "title",
            "description",
            "clientName",
            "priority",
            "status",
            "attachments",
            "createdBy",
            "createdByName",
        ]


class FunctionalRequirementSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    projectId = serializers.CharField(source="project_id")
    hierarchyId = serializers.CharField(source="hierarchy_id")
    epicId = serializers.CharField(source="epic_id", required=False, allow_blank=True)
    sprintId = serializers.CharField(
        source="sprint_id", required=False, allow_blank=True
    )
    clientRequirementId = serializers.CharField(
        source="client_requirement_id", required=False, allow_blank=True
    )
    assignedTo = serializers.JSONField(source="assigned_to", required=False)
    assignedToNames = serializers.JSONField(source="assigned_to_names", required=False)
    linkedProjectIds = serializers.CharField(
        source="linked_project_ids", required=False, allow_blank=True
    )
    createdBy = serializers.CharField(source="created_by_id", read_only=True)
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True, read_only=True
    )

    class Meta:
        model = FunctionalRequirement
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "projectId",
            "hierarchyId",
            "epicId",
            "sprintId",
            "clientRequirementId",
            "title",
            "description",
            "complexity",
            "priority",
            "status",
            "progress",
            "reusable",
            "assignedTo",
            "assignedToNames",
            "tags",
            "linkedProjectIds",
            "createdBy",
            "createdByName",
        ]
