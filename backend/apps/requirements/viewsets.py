from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import ClientRequirement, FunctionalRequirement
from .serializers import ClientRequirementSerializer, FunctionalRequirementSerializer


class _CreatorMixin:
    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(
            created_by=user, created_by_name=getattr(user, "name", "") or ""
        )


class ClientRequirementViewSet(_CreatorMixin, WorkspaceScopedModelViewSet):
    queryset = ClientRequirement.objects.all()
    serializer_class = ClientRequirementSerializer


class FunctionalRequirementViewSet(_CreatorMixin, WorkspaceScopedModelViewSet):
    queryset = FunctionalRequirement.objects.all()
    serializer_class = FunctionalRequirementSerializer
