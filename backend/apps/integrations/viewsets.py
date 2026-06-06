from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import DiscordIntegration, GitCommit, GitHubIntegration, GitLabIntegration
from .serializers import (
    DiscordIntegrationSerializer,
    GitCommitSerializer,
    GitHubIntegrationSerializer,
    GitLabIntegrationSerializer,
)


class GitHubIntegrationViewSet(WorkspaceScopedModelViewSet):
    queryset = GitHubIntegration.objects.all()
    serializer_class = GitHubIntegrationSerializer


class GitLabIntegrationViewSet(WorkspaceScopedModelViewSet):
    queryset = GitLabIntegration.objects.all()
    serializer_class = GitLabIntegrationSerializer


class DiscordIntegrationViewSet(WorkspaceScopedModelViewSet):
    queryset = DiscordIntegration.objects.all()
    serializer_class = DiscordIntegrationSerializer


class GitCommitViewSet(WorkspaceScopedModelViewSet):
    queryset = GitCommit.objects.all()
    serializer_class = GitCommitSerializer
