from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import ActiveTimer, TimeEntry


class TimeEntrySerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    userName = serializers.CharField(source="user_name")
    userEmail = serializers.EmailField(source="user_email")
    createdBy = serializers.CharField(source="created_by_id")
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True
    )
    taskId = serializers.CharField(source="task_id", required=False, allow_blank=True)
    taskTitle = serializers.CharField(
        source="task_title", required=False, allow_blank=True
    )
    taskHierarchyId = serializers.CharField(
        source="task_hierarchy_id", required=False, allow_blank=True
    )
    projectId = serializers.CharField(
        source="project_id", required=False, allow_blank=True
    )
    projectName = serializers.CharField(
        source="project_name", required=False, allow_blank=True
    )
    startTime = serializers.DateTimeField(source="start_time")
    endTime = serializers.DateTimeField(source="end_time")
    isBillable = serializers.BooleanField(source="is_billable", required=False)
    billableRate = serializers.FloatField(
        source="billable_rate", required=False, allow_null=True
    )
    approvedBy = serializers.CharField(
        source="approved_by", required=False, allow_blank=True
    )
    approvedAt = serializers.DateTimeField(
        source="approved_at", required=False, allow_null=True
    )
    rejectionReason = serializers.CharField(
        source="rejection_reason", required=False, allow_blank=True
    )

    class Meta:
        model = TimeEntry
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "userName",
            "userEmail",
            "createdBy",
            "createdByName",
            "taskId",
            "taskTitle",
            "taskHierarchyId",
            "projectId",
            "projectName",
            "description",
            "startTime",
            "endTime",
            "duration",
            "isBillable",
            "billableRate",
            "type",
            "status",
            "approvedBy",
            "approvedAt",
            "rejectionReason",
            "tags",
        ]


class ActiveTimerSerializer(NativeModelSerializer):
    userId = serializers.CharField(source="user_id")
    taskId = serializers.CharField(source="task_id", required=False, allow_blank=True)
    taskTitle = serializers.CharField(
        source="task_title", required=False, allow_blank=True
    )
    taskHierarchyId = serializers.CharField(
        source="task_hierarchy_id", required=False, allow_blank=True
    )
    projectId = serializers.CharField(
        source="project_id", required=False, allow_blank=True
    )
    startTime = serializers.DateTimeField(source="start_time")
    isPaused = serializers.BooleanField(source="is_paused", required=False)
    pausedAt = serializers.DateTimeField(
        source="paused_at", required=False, allow_null=True
    )
    totalPausedTime = serializers.IntegerField(
        source="total_paused_time", required=False
    )
    pomodoroSettings = serializers.JSONField(
        source="pomodoro_settings", required=False, allow_null=True
    )

    class Meta:
        model = ActiveTimer
        fields = [
            "id",
            "created_at",
            "updated_at",
            "userId",
            "taskId",
            "taskTitle",
            "taskHierarchyId",
            "projectId",
            "description",
            "startTime",
            "isPaused",
            "pausedAt",
            "totalPausedTime",
            "type",
            "pomodoroSettings",
        ]
