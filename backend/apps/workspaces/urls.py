from rest_framework.routers import DefaultRouter

from .viewsets import (
    EmailInvitationViewSet,
    InviteCodeViewSet,
    JoinRequestViewSet,
    PendingWorkspaceAccessViewSet,
    WorkspaceMemberViewSet,
    WorkspaceRoleViewSet,
    WorkspaceViewSet,
)

router = DefaultRouter(trailing_slash=True)
router.register(r"workspaces", WorkspaceViewSet, basename="workspaces")
router.register(
    r"workspace_members", WorkspaceMemberViewSet, basename="workspace_members"
)
router.register(r"workspace_roles", WorkspaceRoleViewSet, basename="workspace_roles")
router.register(r"invite_codes", InviteCodeViewSet, basename="invite_codes")
router.register(
    r"email_invitations", EmailInvitationViewSet, basename="email_invitations"
)
router.register(r"join_requests", JoinRequestViewSet, basename="join_requests")
router.register(
    r"pending_workspace_access",
    PendingWorkspaceAccessViewSet,
    basename="pending_workspace_access",
)

urlpatterns = router.urls
