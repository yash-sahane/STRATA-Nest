"""User listing/detail viewset.

Lists users that share at least one workspace with the requester, plus the
requester themself. Platform admins (`is_admin_flag`) see all users.
"""

from __future__ import annotations

from django.db.models import Q
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from .models import User
from .serializers import UserSerializer


class UserViewSet(
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Read-only (+ self update) user directory scoped to shared workspaces."""

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "id"
    lookup_value_regex = r"[A-Za-z0-9_\-]+"
    queryset = User.objects.all()

    def get_queryset(self):
        user = self.request.user
        if getattr(user, "is_superuser", False) or getattr(
            user, "is_admin_flag", False
        ):
            return User.objects.all().order_by("-created_at")
        from apps.workspaces.models import WorkspaceMember

        ws_ids = list(
            WorkspaceMember.objects.filter(
                user_id=user.id, status="ACTIVE"
            ).values_list("workspace_id", flat=True)
        )
        peer_ids = list(
            WorkspaceMember.objects.filter(workspace_id__in=ws_ids)
            .values_list("user_id", flat=True)
            .distinct()
        )
        return User.objects.filter(Q(id__in=peer_ids) | Q(id=user.id)).order_by(
            "-created_at"
        )

    def update(self, request, *args, **kwargs):
        # Only self-update; admin updates go through the admin viewset.
        obj = self.get_object()
        if obj.id != request.user.id and not (
            request.user.is_superuser or getattr(request.user, "is_admin_flag", False)
        ):
            from rest_framework.response import Response

            return Response({"message": "Forbidden"}, status=403)
        return super().update(request, *args, **kwargs)
