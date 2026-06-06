import os

import django
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()

# Imported after django.setup() so Channels middleware can use Django models.
from apps.realtime.auth import JWTCookieAuthMiddlewareStack  # noqa: E402
from apps.realtime.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": JWTCookieAuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
