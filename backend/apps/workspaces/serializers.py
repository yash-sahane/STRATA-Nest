from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import (
    EmailInvitation,
    InviteCode,
    JoinRequest,
    PendingWorkspaceAccess,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
)


class WorkspaceSerializer(NativeModelSerializer):
    ownerId = serializers.CharField(source="owner_id", read_only=True)
    inviteCode = serializers.CharField(source="invite_code", read_only=True)
    memberIds = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = [
            "id",
            "created_at",
            "updated_at",
            "name",
            "description",
            "logo",
            "color",
            "ownerId",
            "inviteCode",
            "settings",
            "memberIds",
        ]

    def get_memberIds(self, obj):  # noqa: N802
        return list(obj.members.values_list("user_id", flat=True))


class WorkspaceMemberSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    email = serializers.EmailField(source="user.email", read_only=True)
    name = serializers.CharField(source="user.name", read_only=True)
    userName = serializers.CharField(source="user.name", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    avatar = serializers.CharField(source="user.avatar", read_only=True)
    joinedAt = serializers.DateTimeField(source="joined_at", read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "email",
            "name",
            "userName",
            "phone",
            "avatar",
            "role",
            "status",
            "joinedAt",
        ]


class WorkspaceRoleSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")

    class Meta:
        model = WorkspaceRole
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "name",
            "permissions",
        ]


class InviteCodeSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    maxUses = serializers.IntegerField(
        source="max_uses", required=False, allow_null=True
    )
    usedCount = serializers.IntegerField(source="used_count", read_only=True)
    expiresAt = serializers.DateTimeField(
        source="expires_at", required=False, allow_null=True
    )
    createdBy = serializers.CharField(source="created_by_id", read_only=True)

    class Meta:
        model = InviteCode
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "code",
            "role",
            "maxUses",
            "usedCount",
            "expiresAt",
            "createdBy",
        ]


class EmailInvitationSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    expiresAt = serializers.DateTimeField(source="expires_at")
    invitedBy = serializers.CharField(source="invited_by_id", read_only=True)

    class Meta:
        model = EmailInvitation
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "email",
            "role",
            "token",
            "status",
            "expiresAt",
            "invitedBy",
        ]


class JoinRequestSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    handledBy = serializers.CharField(
        source="handled_by_id", read_only=True, allow_null=True
    )

    class Meta:
        model = JoinRequest
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "message",
            "status",
            "handledBy",
        ]


class PendingWorkspaceAccessSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    requestedRole = serializers.CharField(source="requested_role")

    class Meta:
        model = PendingWorkspaceAccess
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "requestedRole",
        ]
