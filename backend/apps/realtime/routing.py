from django.urls import path

from .consumers import CollectionConsumer

websocket_urlpatterns = [
    path("ws/collections/", CollectionConsumer.as_asgi()),
]
