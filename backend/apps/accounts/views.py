from __future__ import annotations

import logging
import secrets
import string

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import USER_ROLES, User
from .serializers import (
    ChangePasswordSerializer,
    InviteUserSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
)

logger = logging.getLogger(__name__)
_token_generator = PasswordResetTokenGenerator()


def _set_jwt_cookies(response: Response, refresh: RefreshToken) -> Response:
    access = str(refresh.access_token)
    response.set_cookie(
        settings.JWT_ACCESS_COOKIE_NAME,
        access,
        httponly=True,
        secure=settings.JWT_COOKIE_SECURE,
        samesite=settings.JWT_COOKIE_SAMESITE,
        domain=settings.JWT_COOKIE_DOMAIN,
        path="/",
        max_age=int(settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds()),
    )
    response.set_cookie(
        settings.JWT_REFRESH_COOKIE_NAME,
        str(refresh),
        httponly=True,
        secure=settings.JWT_COOKIE_SECURE,
        samesite=settings.JWT_COOKIE_SAMESITE,
        domain=settings.JWT_COOKIE_DOMAIN,
        path="/",
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
    )
    return response


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        refresh = RefreshToken.for_user(user)
        response = Response(
            {"user": UserSerializer(user).data, "sessionId": refresh["jti"]},
            status=status.HTTP_200_OK,
        )
        return _set_jwt_cookies(response, refresh)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_token = request.COOKIES.get(settings.JWT_REFRESH_COOKIE_NAME)
        if refresh_token:
            try:
                RefreshToken(refresh_token).blacklist()
            except Exception:  # noqa: BLE001
                logger.debug("Refresh token blacklist failed", exc_info=True)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.JWT_ACCESS_COOKIE_NAME, path="/")
        response.delete_cookie(settings.JWT_REFRESH_COOKIE_NAME, path="/")
        return response


class RefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = request.COOKIES.get(settings.JWT_REFRESH_COOKIE_NAME)
        if not refresh_token:
            return Response({"message": "Missing refresh token"}, status=401)
        try:
            refresh = RefreshToken(refresh_token)
            # Rotate
            refresh.set_jti()
            refresh.set_exp()
        except TokenError:
            return Response({"message": "Invalid refresh token"}, status=401)
        response = Response({"ok": True})
        return _set_jwt_cookies(response, refresh)


class MeView(APIView):
    """Return the authenticated profile, session, and workspace flags."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.workspaces.models import WorkspaceMember

        workspace_ids = list(
            WorkspaceMember.objects.filter(user_id=request.user.id).values_list(
                "workspace_id", flat=True
            )
        )
        return Response(
            {
                "user": UserSerializer(request.user).data,
                "session": {
                    "id": str(request.user.id),
                    "userId": str(request.user.id),
                    "current": True,
                },
                "workspaceIds": workspace_ids,
                "hasTempPassword": request.user.has_temp_password,
                "isAdmin": request.user.is_admin_flag or request.user.is_superuser,
            }
        )


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["currentPassword"]):
            return Response({"message": "Current password is incorrect"}, status=400)
        user.set_password(serializer.validated_data["newPassword"])
        user.has_temp_password = False
        user.save(update_fields=["password", "has_temp_password", "updated_at"])
        return Response({"ok": True})


class UpdateProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request):
        user = request.user
        name = request.data.get("name")
        phone = request.data.get("phone")
        avatar = request.data.get("avatar")
        fields = []
        if name is not None:
            user.name = name.strip()
            fields.append("name")
        if phone is not None:
            user.phone = phone.strip()
            fields.append("phone")
        if avatar is not None:
            user.avatar = avatar
            fields.append("avatar")
        if fields:
            user.save(update_fields=fields + ["updated_at"])
        return Response(UserSerializer(user).data)


class RegisterView(APIView):
    """Self-service signup. Returns the new user and sets JWT cookies."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        response = Response(
            {"user": UserSerializer(user).data, "sessionId": refresh["jti"]},
            status=status.HTTP_201_CREATED,
        )
        return _set_jwt_cookies(response, refresh)


class PasswordResetRequestView(APIView):
    """Issue a signed reset token; the email is dispatched by apps.emails."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        # Constant-time response — never reveal whether the email exists.
        user = User.objects.filter(email__iexact=email).first()
        token, uid = None, None
        if user and user.is_active:
            token = _token_generator.make_token(user)
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            try:
                from apps.emails.service import send_password_reset_email

                send_password_reset_email(user=user, uid=uid, token=token)
            except Exception:  # noqa: BLE001
                logger.warning("Password reset email dispatch failed", exc_info=True)
        return Response({"ok": True})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            pk = force_str(urlsafe_base64_decode(serializer.validated_data["uid"]))
            user = User.objects.get(pk=pk)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({"message": "Invalid reset link"}, status=400)
        if not _token_generator.check_token(user, serializer.validated_data["token"]):
            return Response({"message": "Invalid or expired token"}, status=400)
        user.set_password(serializer.validated_data["newPassword"])
        user.has_temp_password = False
        user.save(update_fields=["password", "has_temp_password", "updated_at"])
        return Response({"ok": True})


def _generate_temp_password(length: int = 12) -> str:
    """Random alphanumeric temp password for invited users."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


class InviteUserView(APIView):
    """Admin invitation flow.

    Behaviour:
      * If the email matches an existing user, add them to the workspace and
        return {type: "invitation"}.
      * Otherwise create the user with a temporary password, attach them to
        the workspace, mail the welcome message, and return {type: "new_user"}.
    The caller must be authenticated and either a workspace admin/owner or a
    platform admin.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from apps.workspaces.models import Workspace, WorkspaceMember

        serializer = InviteUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            workspace = Workspace.objects.get(pk=data["workspaceId"])
        except Workspace.DoesNotExist:
            return Response({"message": "Workspace not found"}, status=404)

        # Authorisation: caller must be a member (admin path is implicit on first owner).
        caller_membership = WorkspaceMember.objects.filter(
            workspace=workspace, user=request.user, status="ACTIVE"
        ).first()
        is_platform_admin = request.user.is_superuser or request.user.is_admin_flag
        if (
            not caller_membership
            and not is_platform_admin
            and workspace.owner_id != request.user.id
        ):
            return Response(
                {"message": "Not authorised to invite into this workspace"}, status=403
            )

        existing = User.objects.filter(email__iexact=data["email"]).first()
        workspace_name = data.get("workspaceName") or workspace.name

        if existing:
            if WorkspaceMember.objects.filter(
                workspace=workspace, user=existing
            ).exists():
                return Response(
                    {"message": "User is already a member of this workspace"},
                    status=400,
                )
            WorkspaceMember.objects.create(
                workspace=workspace,
                user=existing,
                role=data["roleName"],
                status="ACTIVE",
            )
            self._send_invite_email(
                to=existing.email,
                workspace_name=workspace_name,
                inviter_name=request.user.name or request.user.email,
                invite_code=workspace.invite_code,
            )
            return Response(
                {
                    "success": True,
                    "type": "invitation",
                    "userId": existing.id,
                    "message": "Workspace invitation sent to existing user",
                }
            )

        # New user path.
        temp_password = _generate_temp_password()
        role_keys = {key for key, _ in USER_ROLES}
        new_user = User.objects.create_user(
            email=data["email"],
            password=temp_password,
            name=data["name"],
            role=data["roleName"] if data["roleName"] in role_keys else "MEMBER",
            workspace_id=workspace.id,
            has_temp_password=True,
        )
        WorkspaceMember.objects.create(
            workspace=workspace, user=new_user, role=data["roleName"], status="ACTIVE"
        )
        # Best-effort welcome mail.
        try:
            from apps.emails.service import send_welcome_email

            send_welcome_email(
                to=new_user.email, name=new_user.name, temp_password=temp_password
            )
        except Exception:  # noqa: BLE001
            logger.warning("Welcome email dispatch failed", exc_info=True)
        return Response(
            {
                "success": True,
                "type": "new_user",
                "userId": new_user.id,
                "message": "User created successfully",
            },
            status=status.HTTP_201_CREATED,
        )

    @staticmethod
    def _send_invite_email(*, to, workspace_name, inviter_name, invite_code):
        try:
            from apps.emails.service import send_workspace_invitation_email

            send_workspace_invitation_email(
                to=to,
                workspace_name=workspace_name,
                inviter_name=inviter_name,
                invite_code=invite_code,
            )
        except Exception:  # noqa: BLE001
            logger.warning("Workspace invitation email dispatch failed", exc_info=True)
