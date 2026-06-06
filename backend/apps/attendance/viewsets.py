from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import Attendance, Holiday
from .serializers import AttendanceSerializer, HolidaySerializer


class AttendanceViewSet(WorkspaceScopedModelViewSet):
    queryset = Attendance.objects.all()
    serializer_class = AttendanceSerializer


class HolidayViewSet(WorkspaceScopedModelViewSet):
    queryset = Holiday.objects.all()
    serializer_class = HolidaySerializer
