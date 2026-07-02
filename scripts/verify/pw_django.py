"""Django-side password oracle for cross-verification (Phase 1A).

Uses the REAL Django PBKDF2PasswordHasher — the same code the production app uses.
No database required.
  make  <password>            -> prints the Django-format hash
  check <hash> <password>     -> prints True/False
"""
import sys

import django
from django.conf import settings

settings.configure(
    PASSWORD_HASHERS=["django.contrib.auth.hashers.PBKDF2PasswordHasher"],
)
django.setup()

from django.contrib.auth.hashers import check_password, make_password  # noqa: E402

cmd = sys.argv[1]
if cmd == "make":
    sys.stdout.write(make_password(sys.argv[2]))
elif cmd == "check":
    ok = check_password(sys.argv[3], sys.argv[2])
    sys.stdout.write("True" if ok else "False")
else:
    sys.stderr.write(f"unknown command: {cmd}\n")
    sys.exit(2)
