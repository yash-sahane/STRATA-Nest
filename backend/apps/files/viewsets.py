from __future__ import annotations

import logging

from django.http import FileResponse, Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import UploadedFile
from .serializers import UploadedFileSerializer

logger = logging.getLogger(__name__)


class UploadedFileViewSet(viewsets.ModelViewSet):
    """Multipart upload + standard CRUD + stream actions."""

    serializer_class = UploadedFileSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    queryset = UploadedFile.objects.all()
    lookup_field = "id"
    lookup_value_regex = r"[A-Za-z0-9_\-]+"

    def get_queryset(self):
        user = self.request.user
        qs = UploadedFile.objects.all()
        if getattr(user, "is_superuser", False) or getattr(
            user, "is_admin_flag", False
        ):
            return qs
        from apps.workspaces.models import WorkspaceMember

        ws_ids = list(
            WorkspaceMember.objects.filter(
                user_id=user.id, status="ACTIVE"
            ).values_list("workspace_id", flat=True)
        )
        return qs.filter(workspace_id__in=ws_ids + [""])

    def create(self, request, *args, **kwargs):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"message": "Missing 'file' in multipart body"}, status=400)
        explicit_id = request.data.get("id")
        kwargs_ = {
            "name": upload.name,
            "file": upload,
            "mime_type": getattr(upload, "content_type", "") or "",
            "size": getattr(upload, "size", 0) or 0,
            "workspace_id": request.data.get("workspaceId")
            or request.data.get("workspace_id")
            or "",
            "project_id": request.data.get("projectId")
            or request.data.get("project_id")
            or "",
            "uploaded_by": request.user,
            "bucket": request.data.get("bucketId") or "default",
        }
        if explicit_id:
            kwargs_["id"] = explicit_id
        obj = UploadedFile.objects.create(**kwargs_)
        return Response(self.get_serializer(obj).data, status=status.HTTP_201_CREATED)

    # --- Streaming helpers --------------------------------------------
    def _stream(self, obj: UploadedFile, *, as_attachment: bool):
        try:
            handle = obj.file.open("rb")
        except Exception as exc:  # noqa: BLE001
            raise Http404 from exc
        response = FileResponse(
            handle, content_type=obj.mime_type or "application/octet-stream"
        )
        disposition = "attachment" if as_attachment else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{obj.name}"'
        return response

    @action(detail=True, methods=["get"])
    def preview(self, request, id=None):  # noqa: A002 (matches lookup_field)
        return self._stream(self.get_object(), as_attachment=False)

    @action(detail=True, methods=["get"])
    def view(self, request, id=None):  # noqa: A002
        return self._stream(self.get_object(), as_attachment=False)

    @action(detail=True, methods=["get"])
    def download(self, request, id=None):  # noqa: A002
        return self._stream(self.get_object(), as_attachment=True)

    def perform_destroy(self, instance):
        try:
            instance.file.delete(save=False)
        except Exception:  # noqa: BLE001
            logger.warning(
                "Uploaded file blob deletion failed",
                extra={"file_id": instance.id},
                exc_info=True,
            )
        instance.delete()
