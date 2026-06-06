from __future__ import annotations

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer
from apps.workspaces.models import WorkspaceMember

from .models import User


class UserSerializer(NativeModelSerializer):
    """Emits the `User` shape consumed by src/types/index.ts and auth-provider.tsx."""

    workspaceId = serializers.CharField(
        source="workspace_id", required=False, allow_blank=True
    )
    defaultWorkspaceId = serializers.CharField(
        source="workspace_id", required=False, allow_blank=True
    )
    workspaceIds = serializers.SerializerMethodField()
    hasTempPassword = serializers.BooleanField(
        source="has_temp_password", required=False
    )
    isAdmin = serializers.BooleanField(source="is_admin_flag", required=False)
    userEmail = serializers.EmailField(source="email", read_only=True)

    def get_workspaceIds(self, obj):  # noqa: N802
        return list(
            WorkspaceMember.objects.filter(user_id=obj.id, status="ACTIVE").values_list(
                "workspace_id", flat=True
            )
        )

    class Meta:
        model = User
        fields = [
            "id",
            "created_at",
            "updated_at",
            "email",
            "userEmail",
            "name",
            "phone",
            "avatar",
            "role",
            "workspaceId",
            "defaultWorkspaceId",
            "workspaceIds",
            "status",
            "hasTempPassword",
            "isAdmin",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "hasTempPassword",
            "isAdmin",
        ]


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        user = authenticate(
            request=self.context.get("request"),
            username=data["email"],
            password=data["password"],
        )
        if not user or not user.is_active:
            raise serializers.ValidationError("Invalid email or password")
        data["user"] = user
        return data


class ChangePasswordSerializer(serializers.Serializer):
    currentPassword = serializers.CharField(write_only=True)
    newPassword = serializers.CharField(write_only=True, min_length=8)


class RegisterSerializer(serializers.Serializer):
    """Self-service signup."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    name = serializers.CharField(max_length=255)
    phone = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default=""
    )
    workspaceId = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists")
        return value.lower()

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            name=validated_data["name"],
            phone=validated_data.get("phone", ""),
            workspace_id=validated_data.get("workspaceId", ""),
        )


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    newPassword = serializers.CharField(write_only=True, min_length=8)

    def validate_newPassword(self, value):  # noqa: N802
        validate_password(value)
        return value


class InviteUserSerializer(serializers.Serializer):
    """Admin-driven invitation flow.

    Fields use camelCase to match the existing Next.js callers.
    """

    name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    roleName = serializers.CharField(max_length=64, required=False, default="MEMBER")
    workspaceId = serializers.CharField(max_length=36)
    workspaceName = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default=""
    )

    def validate_email(self, value):
        return value.lower()
