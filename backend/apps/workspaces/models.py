"""Workspace + membership models.

`memberIds` is a derived array; the serializer composes it from `WorkspaceMember`.
"""

from __future__ import annotations

import secrets

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel


def _generate_invite_code() -> str:
    return secrets.token_urlsafe(8)[:10].upper()


class Workspace(TimestampedModel):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    logo = models.URLField(max_length=500, blank=True, default="")
    color = models.CharField(max_length=50, blank=True, default="")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_workspaces",
    )
    invite_code = models.CharField(
        max_length=20, unique=True, default=_generate_invite_code
    )
    settings = models.JSONField(default=dict)

    REALTIME_COLLECTION = "workspaces"

    def __str__(self) -> str:
        return self.name


WORKSPACE_MEMBER_STATUS = [
    ("ACTIVE", "Active"),
    ("PENDING", "Pending"),
    ("INACTIVE", "Inactive"),
]


class WorkspaceMember(TimestampedModel):
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="members"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_memberships",
    )
    role = models.CharField(max_length=32, default="MEMBER")
    status = models.CharField(
        max_length=20, choices=WORKSPACE_MEMBER_STATUS, default="ACTIVE"
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("workspace", "user")]
        ordering = ["-created_at"]

    REALTIME_COLLECTION = "workspace_members"


class WorkspaceRole(TimestampedModel):
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="custom_roles"
    )
    name = models.CharField(max_length=64)
    permissions = models.JSONField(default=list)

    class Meta:
        unique_together = [("workspace", "name")]


class InviteCode(TimestampedModel):
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="invite_codes"
    )
    code = models.CharField(max_length=32, unique=True)
    role = models.CharField(max_length=32, default="MEMBER")
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    used_count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_invite_codes",
    )


EMAIL_INVITATION_STATUS = [
    ("PENDING", "Pending"),
    ("ACCEPTED", "Accepted"),
    ("EXPIRED", "Expired"),
    ("REVOKED", "Revoked"),
]


class EmailInvitation(TimestampedModel):
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="email_invitations"
    )
    email = models.EmailField()
    role = models.CharField(max_length=32, default="MEMBER")
    token = models.CharField(max_length=64, unique=True)
    status = models.CharField(
        max_length=20, choices=EMAIL_INVITATION_STATUS, default="PENDING"
    )
    expires_at = models.DateTimeField()
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="sent_invitations",
    )


JOIN_REQUEST_STATUS = [
    ("PENDING", "Pending"),
    ("APPROVED", "Approved"),
    ("REJECTED", "Rejected"),
]


class JoinRequest(TimestampedModel):
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="join_requests"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="join_requests"
    )
    message = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20, choices=JOIN_REQUEST_STATUS, default="PENDING"
    )
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="handled_join_requests",
    )

    class Meta:
        unique_together = [("workspace", "user")]


class PendingWorkspaceAccess(TimestampedModel):
    """Pending access request for a workspace."""

    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="pending_access"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pending_access",
    )
    requested_role = models.CharField(max_length=32, default="MEMBER")
