from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import Epic
from .serializers import EpicSerializer


class EpicViewSet(WorkspaceScopedModelViewSet):
    queryset = Epic.objects.all()
    serializer_class = EpicSerializer

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(
            created_by=user, created_by_name=getattr(user, "name", "") or ""
        )
