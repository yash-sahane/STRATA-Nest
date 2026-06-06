"""Channels middleware that authenticates the WebSocket using the JWT cookie.

Per gap §13.5 we do NOT accept `?token=...` in the URL.
"""

from __future__ import annotations

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


@database_sync_to_async
def _user_from_token(raw_token: str):
    try:
        from rest_framework_simplejwt.authentication import JWTAuthentication

        auth = JWTAuthentication()
        validated = auth.get_validated_token(raw_token)
        return auth.get_user(validated)
    except (AuthenticationFailed, InvalidToken, TokenError):
        return AnonymousUser()


class JWTCookieAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        cookies = {}
        for name, value in scope.get("headers", []):
            if name == b"cookie":
                for chunk in value.decode().split(";"):
                    if "=" in chunk:
                        k, _, v = chunk.strip().partition("=")
                        cookies[k] = v
        token = cookies.get(settings.JWT_ACCESS_COOKIE_NAME)
        scope["user"] = await _user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)


def JWTCookieAuthMiddlewareStack(inner):  # noqa: N802 (mirrors Channels' naming)
    return JWTCookieAuthMiddleware(AuthMiddlewareStack(inner))
