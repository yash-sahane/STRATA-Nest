from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import (
    EmailInvitation,
    InviteCode,
    JoinRequest,
    PendingWorkspaceAccess,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
)
from .serializers import (
    EmailInvitationSerializer,
    InviteCodeSerializer,
    JoinRequestSerializer,
    PendingWorkspaceAccessSerializer,
    WorkspaceMemberSerializer,
    WorkspaceRoleSerializer,
    WorkspaceSerializer,
)


class WorkspaceViewSet(WorkspaceScopedModelViewSet):
    queryset = Workspace.objects.all()
    serializer_class = WorkspaceSerializer

    def perform_create(self, serializer):
        ws = serializer.save(owner=self.request.user)
        # Owner auto-becomes ACTIVE member.
        WorkspaceMember.objects.get_or_create(
            workspace=ws, user=self.request.user, defaults={"role": "MANAGER"}
        )


class WorkspaceMemberViewSet(WorkspaceScopedModelViewSet):
    queryset = WorkspaceMember.objects.all()
    serializer_class = WorkspaceMemberSerializer


class WorkspaceRoleViewSet(WorkspaceScopedModelViewSet):
    queryset = WorkspaceRole.objects.all()
    serializer_class = WorkspaceRoleSerializer


class InviteCodeViewSet(WorkspaceScopedModelViewSet):
    queryset = InviteCode.objects.all()
    serializer_class = InviteCodeSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class EmailInvitationViewSet(WorkspaceScopedModelViewSet):
    queryset = EmailInvitation.objects.all()
    serializer_class = EmailInvitationSerializer

    def perform_create(self, serializer):
        serializer.save(invited_by=self.request.user)


class JoinRequestViewSet(WorkspaceScopedModelViewSet):
    queryset = JoinRequest.objects.all()
    serializer_class = JoinRequestSerializer


class PendingWorkspaceAccessViewSet(WorkspaceScopedModelViewSet):
    queryset = PendingWorkspaceAccess.objects.all()
    serializer_class = PendingWorkspaceAccessSerializer
