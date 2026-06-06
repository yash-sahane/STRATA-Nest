"""Base viewsets for native workspace-scoped resources."""

from __future__ import annotations

from django.core.exceptions import FieldDoesNotExist
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated


class WorkspaceScopedModelViewSet(viewsets.ModelViewSet):
    """ModelViewSet that enforces workspace membership for scoped models."""

    permission_classes = [IsAuthenticated]
    lookup_field = "id"
    lookup_value_regex = r"[A-Za-z0-9_\-]+"
    scope_to_workspaces = True

    def _user_workspace_ids(self) -> list[str]:
        user = self.request.user
        if not getattr(user, "is_authenticated", False):
            return []
        from apps.workspaces.models import WorkspaceMember

        return list(
            WorkspaceMember.objects.filter(
                user_id=user.id, status="ACTIVE"
            ).values_list("workspace_id", flat=True)
        )

    @staticmethod
    def _model_has_workspace(model) -> bool:
        for name in ("workspace", "workspace_id"):
            try:
                model._meta.get_field(name)
                return True
            except FieldDoesNotExist:
                continue
        return False

    def get_queryset(self):
        qs = super().get_queryset()
        model = qs.model
        user = self.request.user
        ws = self.request.query_params.get(
            "workspaceId"
        ) or self.request.query_params.get("workspace_id")
        if ws and self._model_has_workspace(model):
            qs = qs.filter(workspace_id=ws)
        if (
            self.scope_to_workspaces
            and self._model_has_workspace(model)
            and not getattr(user, "is_superuser", False)
            and not getattr(user, "is_admin_flag", False)
        ):
            qs = qs.filter(workspace_id__in=self._user_workspace_ids())
        return qs
