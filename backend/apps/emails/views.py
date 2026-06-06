"""HTTP endpoints that port the Next.js `send-*-email` routes."""

from __future__ import annotations

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .service import (
    send_generic_notification_email,
    send_leave_notification_email,
    send_workspace_invitation_email,
)


class InvitationSerializer(serializers.Serializer):
    to = serializers.EmailField()
    workspaceName = serializers.CharField()
    inviterName = serializers.CharField()
    inviteCode = serializers.CharField()


class GenericEmailSerializer(serializers.Serializer):
    to = serializers.ListField(child=serializers.EmailField())
    subject = serializers.CharField()
    html = serializers.CharField()
    text = serializers.CharField(required=False, allow_blank=True)


class SendInvitationEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        s = InvitationSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        result = send_workspace_invitation_email(
            to=v["to"],
            workspace_name=v["workspaceName"],
            inviter_name=v["inviterName"],
            invite_code=v["inviteCode"],
        )
        return Response(
            {"success": result.get("sent", False), **result}, status=status.HTTP_200_OK
        )


class SendLeaveEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        s = GenericEmailSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        result = send_leave_notification_email(
            to=v["to"],
            subject=v["subject"],
            html=v["html"],
            text=v.get("text") or None,
        )
        return Response({"success": result.get("sent", False), **result})


class SendNotificationEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        s = GenericEmailSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        result = send_generic_notification_email(
            to=v["to"],
            subject=v["subject"],
            html=v["html"],
            text=v.get("text") or None,
        )
        return Response({"success": result.get("sent", False), **result})
