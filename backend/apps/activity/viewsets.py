from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import ActivityLog, SavedSearch
from .serializers import ActivityLogSerializer, SavedSearchSerializer


class ActivityLogViewSet(WorkspaceScopedModelViewSet):
    queryset = ActivityLog.objects.all()
    serializer_class = ActivityLogSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class SavedSearchViewSet(WorkspaceScopedModelViewSet):
    queryset = SavedSearch.objects.all()
    serializer_class = SavedSearchSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
