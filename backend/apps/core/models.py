"""Shared model bases."""

from __future__ import annotations

import secrets
import string

from django.db import models

_ALPHABET = string.ascii_letters + string.digits


def generate_native_id() -> str:
    """Return a compact URL-safe primary key for domain resources."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(20))


class TimestampedModel(models.Model):
    """Base for every domain model.

    Notes:
          * `id` is a CharField so public resource IDs remain short and stable.
          * Default ordering is newest first.
    """

    id = models.CharField(
        primary_key=True, max_length=36, default=generate_native_id, editable=False
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["-created_at"]
