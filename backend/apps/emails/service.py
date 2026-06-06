"""Email transport with Resend as primary and Django send_mail as fallback.

Why this exists: email delivery belongs on the Django side so the React
frontend does not ship API keys or duplicate notification transport logic.

Calling Resend over HTTPS using `requests` (already a transitive dependency)
keeps the surface tiny — no SDK to vendor.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import send_mail as django_send_mail

logger = logging.getLogger(__name__)


def _resend_send(
    *, to: str | list[str], subject: str, html: str, text: str | None = None
) -> dict:
    api_key = getattr(settings, "RESEND_API_KEY", "")
    sender = getattr(settings, "EMAIL_FROM", "noreply@example.com")
    if not api_key:
        # Fallback so dev/test work without external services.
        recipients = [to] if isinstance(to, str) else list(to)
        django_send_mail(
            subject=subject,
            message=text or "",
            html_message=html,
            from_email=sender,
            recipient_list=recipients,
            fail_silently=True,
        )
        return {"backend": "django", "sent": True}

    import requests  # imported lazily — only needed when key present

    recipients = [to] if isinstance(to, str) else list(to)
    payload = {
        "from": sender,
        "to": recipients,
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        if r.status_code >= 400:
            logger.warning("Resend send failed (%s): %s", r.status_code, r.text)
            return {"backend": "resend", "sent": False, "error": r.text}
        return {"backend": "resend", "sent": True, "id": r.json().get("id")}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Resend transport error", exc_info=exc)
        return {"backend": "resend", "sent": False, "error": str(exc)}


# ---- Higher-level helpers ------------------------------------------------


def send_workspace_invitation_email(
    *, to: str, workspace_name: str, inviter_name: str, invite_code: str
) -> dict:
    subject = f"You've been invited to join {workspace_name}"
    html = f"""
    <h2>Hi,</h2>
    <p>{inviter_name} has invited you to join the <strong>{workspace_name}</strong>
    workspace on L-T-Connect.</p>
    <p>Your invitation code is: <code>{invite_code}</code></p>
    """
    return _resend_send(to=to, subject=subject, html=html)


def send_leave_notification_email(
    *, to: str | list[str], subject: str, html: str, text: str | None = None
) -> dict:
    return _resend_send(to=to, subject=subject, html=html, text=text)


def send_generic_notification_email(
    *, to: str | list[str], subject: str, html: str, text: str | None = None
) -> dict:
    return _resend_send(to=to, subject=subject, html=html, text=text)


def send_welcome_email(*, to: str, name: str, temp_password: str | None = None) -> dict:
    subject = "Welcome to L-T-Connect"
    extra = (
        f"<p>Your temporary password is <code>{temp_password}</code>. Please change it after first login.</p>"
        if temp_password
        else ""
    )
    html = f"<h2>Welcome, {name}!</h2><p>Your account has been created.</p>{extra}"
    return _resend_send(to=to, subject=subject, html=html)


def send_password_reset_email(*, user, uid: str, token: str) -> dict:
    base = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
    link = f"{base}/reset-password?uid={uid}&token={token}"
    subject = "Reset your L-T-Connect password"
    html = f"""
    <p>Hi {user.name},</p>
    <p>Click the link below to reset your password (valid for a limited time):</p>
    <p><a href="{link}">{link}</a></p>
    """
    return _resend_send(to=user.email, subject=subject, html=html)
