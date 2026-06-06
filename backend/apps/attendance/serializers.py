from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import Attendance, Holiday


class AttendanceSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    checkInTime = serializers.DateTimeField(source="check_in_time")
    checkOutTime = serializers.DateTimeField(
        source="check_out_time", required=False, allow_null=True
    )
    workHours = serializers.FloatField(
        source="work_hours", required=False, allow_null=True
    )
    lateMinutes = serializers.IntegerField(source="late_minutes", required=False)
    isWeekend = serializers.BooleanField(source="is_weekend", required=False)
    isHoliday = serializers.BooleanField(source="is_holiday", required=False)
    createdBy = serializers.CharField(
        source="created_by_id", required=False, allow_null=True
    )
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True
    )

    class Meta:
        model = Attendance
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "date",
            "checkInTime",
            "checkOutTime",
            "workHours",
            "status",
            "lateMinutes",
            "location",
            "notes",
            "isWeekend",
            "isHoliday",
            "createdBy",
            "createdByName",
        ]


class HolidaySerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    isOptional = serializers.BooleanField(source="is_optional", required=False)

    class Meta:
        model = Holiday
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "name",
            "date",
            "isOptional",
            "description",
        ]
