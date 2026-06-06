"""post_save / post_delete -> broadcast native resource events."""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_save)
def _broadcast_save(sender, instance, created, **kwargs):
    coll = getattr(instance, "REALTIME_COLLECTION", None)
    if not coll:
        return
    layer = get_channel_layer()
    if layer is None:
        return
    op = "create" if created else "update"
    payload = _safe_serialize(instance)
    event_name = f"{coll}.{op}"
    channels = [coll, f"{coll}.{instance.pk}"]
    msg = {
        "type": "collection.event",
        "event": event_name,
        "payload": payload,
        "channels": channels,
    }
    for ch in channels:
        async_to_sync(layer.group_send)("rt_" + ch.replace(".", "_"), msg)


@receiver(post_delete)
def _broadcast_delete(sender, instance, **kwargs):
    coll = getattr(instance, "REALTIME_COLLECTION", None)
    if not coll:
        return
    layer = get_channel_layer()
    if layer is None:
        return
    channels = [coll, f"{coll}.{instance.pk}"]
    msg = {
        "type": "collection.event",
        "event": f"{coll}.delete",
        "payload": {"id": str(instance.pk)},
        "channels": channels,
    }
    for ch in channels:
        async_to_sync(layer.group_send)("rt_" + ch.replace(".", "_"), msg)


def _safe_serialize(instance) -> dict:
    """Best-effort serialization for realtime payloads.

    Domain modules should register a dedicated serializer override later;
    this minimal version emits primary key + scalar fields so the frontend
    has at least `id` to invalidate its TanStack Query cache.
    """
    out = {"id": str(instance.pk)}
    for f in instance._meta.fields:
        if f.is_relation or f.name in ("id", "password"):
            continue
        try:
            v = getattr(instance, f.name)
            if hasattr(v, "isoformat"):
                v = v.isoformat().replace("+00:00", "Z")
            out[_camel(f.name)] = v
        except Exception:  # noqa: BLE001
            logger.debug(
                "Realtime serialization skipped field",
                extra={"model": instance.__class__.__name__, "field": f.name},
                exc_info=True,
            )
            continue
    return out


def _camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])
