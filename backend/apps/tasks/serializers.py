from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import KanbanColumn, Label, Task, TaskComment


class TaskSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    projectId = serializers.CharField(source="project_id")
    hierarchyId = serializers.CharField(source="hierarchy_id")
    sprintId = serializers.CharField(
        source="sprint_id", required=False, allow_blank=True
    )
    epicId = serializers.CharField(source="epic_id", required=False, allow_blank=True)
    functionalRequirementId = serializers.CharField(
        source="functional_requirement_id", required=False, allow_blank=True
    )
    parentTaskId = serializers.CharField(
        source="parent_task_id", required=False, allow_blank=True
    )
    assigneeIds = serializers.JSONField(source="assignee_ids", required=False)
    assignedBy = serializers.CharField(
        source="assigned_by", required=False, allow_blank=True
    )
    assignedByName = serializers.CharField(
        source="assigned_by_name", required=False, allow_blank=True
    )
    assignedTo = serializers.JSONField(source="assigned_to", required=False)
    assignedToNames = serializers.JSONField(source="assigned_to_names", required=False)
    watcherIds = serializers.JSONField(source="watcher_ids", required=False)
    createdBy = serializers.CharField(source="created_by_id", read_only=True)
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True, read_only=True
    )
    dueDate = serializers.DateTimeField(
        source="due_date", required=False, allow_null=True
    )
    estimatedHours = serializers.FloatField(
        source="estimated_hours", required=False, allow_null=True
    )
    actualHours = serializers.FloatField(
        source="actual_hours", required=False, allow_null=True
    )
    customFields = serializers.JSONField(source="custom_fields", required=False)
    blockedBy = serializers.JSONField(source="blocked_by", required=False)

    class Meta:
        model = Task
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "projectId",
            "hierarchyId",
            "sprintId",
            "epicId",
            "functionalRequirementId",
            "parentTaskId",
            "title",
            "description",
            "status",
            "priority",
            "assigneeIds",
            "assignedBy",
            "assignedByName",
            "assignedTo",
            "assignedToNames",
            "watcherIds",
            "createdBy",
            "createdByName",
            "dueDate",
            "estimatedHours",
            "actualHours",
            "labels",
            "attachments",
            "customFields",
            "position",
            "blockedBy",
            "blocks",
        ]


class TaskCommentSerializer(NativeModelSerializer):
    taskId = serializers.CharField(source="task_id")
    userId = serializers.CharField(source="user_id")

    class Meta:
        model = TaskComment
        fields = [
            "id",
            "created_at",
            "updated_at",
            "taskId",
            "userId",
            "content",
            "mentions",
            "attachments",
        ]


class KanbanColumnSerializer(NativeModelSerializer):
    projectId = serializers.CharField(source="project_id")
    wipLimit = serializers.IntegerField(
        source="wip_limit", required=False, allow_null=True
    )

    class Meta:
        model = KanbanColumn
        fields = [
            "id",
            "created_at",
            "updated_at",
            "projectId",
            "name",
            "status",
            "wipLimit",
            "position",
            "color",
        ]


class LabelSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    projectId = serializers.CharField(
        source="project_id", required=False, allow_null=True
    )

    class Meta:
        model = Label
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "projectId",
            "name",
            "color",
            "description",
        ]
