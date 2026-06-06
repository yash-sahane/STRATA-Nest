"""Serializer primitives for the native L-T-Connect REST API."""

from __future__ import annotations

from rest_framework import serializers


class NativeModelSerializer(serializers.ModelSerializer):
    """Base serializer for domain resources.

    Model fields stay Pythonic internally (`created_at`, `updated_at`) while API
    responses expose the camelCase contract used by the frontend.
    """

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if "id" in data:
            data["id"] = str(data["id"])
        if "created_at" in data:
            data["createdAt"] = data.pop("created_at")
        if "updated_at" in data:
            data["updatedAt"] = data.pop("updated_at")
        return data

    def to_internal_value(self, data):
        if isinstance(data, dict):
            data = {
                k: v for k, v in data.items() if k not in ("createdAt", "updatedAt")
            }
        return super().to_internal_value(data)
