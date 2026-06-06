"""Channels consumer for native realtime resource events.

Client frame to subscribe:
    {"action": "subscribe", "channels": ["tasks", "tasks.<id>"]}

Server pushes frames:
    {"event": "task.updated", "payload": {...}, "channels": [...], "timestamp": "..."}
"""

from __future__ import annotations

from datetime import datetime, timezone

from channels.generic.websocket import AsyncJsonWebsocketConsumer


def _group_name(channel: str) -> str:
    return "rt_" + channel.replace(".", "_")


class CollectionConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        if self.scope["user"].is_anonymous:
            await self.close(code=4401)
            return
        self.subscribed: set[str] = set()
        await self.accept()

    async def disconnect(self, code):
        for ch in list(getattr(self, "subscribed", set())):
            await self.channel_layer.group_discard(_group_name(ch), self.channel_name)

    async def receive_json(self, content, **kwargs):
        action = content.get("action")
        channels = content.get("channels", []) or []
        if action == "subscribe":
            for ch in channels:
                await self.channel_layer.group_add(_group_name(ch), self.channel_name)
                self.subscribed.add(ch)
        elif action == "unsubscribe":
            for ch in channels:
                await self.channel_layer.group_discard(
                    _group_name(ch), self.channel_name
                )
                self.subscribed.discard(ch)

    async def collection_event(self, message):
        """Group-broadcast handler for domain events."""
        await self.send_json(
            {
                "event": message.get("event", "resource.updated"),
                "payload": message.get("payload", {}),
                "channels": message.get("channels", []),
                "timestamp": datetime.now(tz=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            }
        )
