"""Custom user model for authentication and workspace membership."""

from __future__ import annotations

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models

from apps.core.models import TimestampedModel
from .managers import UserManager

USER_ROLES = [
    ("MANAGER", "Manager"),
    ("ASSISTANT_MANAGER", "Assistant Manager"),
    ("SOFTWARE_DEVELOPER", "Software Developer"),
    ("DEVELOPER_INTERN", "Developer Intern"),
    ("TESTER", "Tester"),
    ("CONTENT_ENGINEER", "Content Engineer"),
    ("MEMBER", "Member"),
]

USER_STATUS = [("ACTIVE", "Active"), ("INACTIVE", "Inactive")]


class User(AbstractBaseUser, PermissionsMixin, TimestampedModel):
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=50, blank=True, default="")
    avatar = models.URLField(max_length=500, blank=True, default="")
    role = models.CharField(max_length=32, choices=USER_ROLES, default="MEMBER")

    # Denormalized default workspace. The richer multi-workspace membership
    # lives in `workspaces.WorkspaceMember`.
    workspace_id = models.CharField(max_length=36, blank=True, default="")

    status = models.CharField(max_length=20, choices=USER_STATUS, default="ACTIVE")

    # Account-state flags consumed by the frontend auth provider.
    has_temp_password = models.BooleanField(default=False)
    is_admin_flag = models.BooleanField(
        default=False
    )  # platform-wide admin (separate from is_superuser)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.email} ({self.name})"
