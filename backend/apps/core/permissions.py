"""Workspace-aware DRF permissions."""

from __future__ import annotations

from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsWorkspaceMember(BasePermission):
    """User must be a member of `obj.workspace`."""

    def has_object_permission(self, request, view, obj):
        ws = getattr(obj, "workspace", None) or getattr(obj, "workspace_id", None)
        if ws is None:
            return True
        from apps.workspaces.models import WorkspaceMember

        return WorkspaceMember.objects.filter(
            workspace_id=getattr(ws, "id", ws),
            user_id=request.user.id,
        ).exists()


class IsOwnerOrReadOnly(BasePermission):
    """Write only if request.user created the row."""

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        return getattr(obj, "created_by_id", None) == request.user.id
