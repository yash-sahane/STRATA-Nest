from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(WorkspaceScopedModelViewSet):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer

    @action(detail=False, methods=["post"], url_path="mark_all_read")
    def mark_all_read(self, request):
        qs = self.get_queryset().filter(user=request.user, is_read=False)
        updated = qs.update(is_read=True)
        return Response({"updated": updated})
