from __future__ import annotations

import pyotp


def generate_totp(secret: str) -> str:
    # Clean secret: remove spaces and ensure upper case
    clean_secret = secret.replace(" ", "").upper()
    # Fix padding if necessary
    missing_padding = len(clean_secret) % 8
    if missing_padding:
        clean_secret += "=" * (8 - missing_padding)
    return pyotp.TOTP(clean_secret).now()

