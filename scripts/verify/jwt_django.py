"""Django SimpleJWT oracle for cross-verification (Phase 1A). No DB required.
  sign   <user_id>   -> prints a SimpleJWT-signed access token (HS256, shared key)
  verify <token>     -> prints JSON {user_id, token_type, jti} or VERIFY_FAIL:<err>
"""
import json
import sys

import django
from django.conf import settings

SECRET = "shared-secret-for-cross-verify"
settings.configure(
    SECRET_KEY=SECRET,
    INSTALLED_APPS=["django.contrib.contenttypes", "django.contrib.auth"],
    USE_TZ=True,
    SIMPLE_JWT={"ALGORITHM": "HS256", "SIGNING_KEY": SECRET, "USER_ID_CLAIM": "user_id"},
)
django.setup()

from rest_framework_simplejwt.tokens import AccessToken  # noqa: E402

cmd = sys.argv[1]
if cmd == "sign":
    t = AccessToken()
    t["user_id"] = sys.argv[2]
    sys.stdout.write(str(t))
elif cmd == "verify":
    try:
        t = AccessToken(sys.argv[2])
        sys.stdout.write(
            json.dumps(
                {"user_id": t["user_id"], "token_type": t.get("token_type"), "jti": t.get("jti")}
            )
        )
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write("VERIFY_FAIL:" + str(exc))
else:
    sys.stderr.write(f"unknown command: {cmd}\n")
    sys.exit(2)
