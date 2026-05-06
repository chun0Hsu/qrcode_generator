import secrets
import string

from sqlalchemy.orm import Session

from .models import UrlMapping


BASE62_CHARS = string.ascii_letters + string.digits
TOKEN_LENGTH = 7
MAX_RETRIES = 10


def generate_token(db: Session) -> str:
    for _ in range(MAX_RETRIES):
        token = "".join(secrets.choice(BASE62_CHARS) for _ in range(TOKEN_LENGTH))
        exists = db.query(UrlMapping.id).filter(UrlMapping.token == token).first()
        if exists is None:
            return token
    raise RuntimeError("Could not generate a unique token")
