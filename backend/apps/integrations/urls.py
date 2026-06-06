from rest_framework.routers import DefaultRouter

from .viewsets import (
    DiscordIntegrationViewSet,
    GitCommitViewSet,
    GitHubIntegrationViewSet,
    GitLabIntegrationViewSet,
)

router = DefaultRouter(trailing_slash=True)
router.register(
    r"github_integrations", GitHubIntegrationViewSet, basename="github_integrations"
)
router.register(
    r"gitlab_integrations", GitLabIntegrationViewSet, basename="gitlab_integrations"
)
router.register(
    r"discord_integrations", DiscordIntegrationViewSet, basename="discord_integrations"
)
router.register(r"git_commits", GitCommitViewSet, basename="git_commits")

urlpatterns = router.urls
