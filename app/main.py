import io
import re
from datetime import datetime, timezone

import qrcode
from qrcode.image.svg import SvgPathImage
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import BASE_URL
from .database import Base, engine, get_db
from .models import ScanEvent, UrlMapping
from .schemas import CreateRequest, CreateResponse, QRInfoResponse, UpdateRequest
from .token_gen import MAX_RETRIES, generate_token
from .url_validator import validate_url


Base.metadata.create_all(bind=engine)

app = FastAPI(title="QR Code Generator Prototype")
redirect_cache: dict[str, str] = {}

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
def spa():
    return FileResponse("static/index.html")


@app.post("/api/qr/create", response_model=CreateResponse)
def create_qr(req: CreateRequest, db: Session = Depends(get_db)):
    normalized_url = _validate_request_url(req.url)
    expires_at = _normalize_datetime(req.expires_at)
    mapping = _create_mapping_with_unique_token(normalized_url, expires_at, db)

    short_url = f"{BASE_URL}/r/{mapping.token}"
    redirect_cache[mapping.token] = mapping.original_url

    return CreateResponse(
        token=mapping.token,
        short_url=short_url,
        qr_code_url=f"{BASE_URL}/api/qr/{mapping.token}/image",
        original_url=mapping.original_url,
    )


@app.get("/r/{token}")
def redirect(token: str, request: Request, db: Session = Depends(get_db)):
    cached_url = redirect_cache.get(token)
    if cached_url is not None:
        _record_scan(token, request, db)
        return RedirectResponse(cached_url, status_code=302)

    mapping = db.query(UrlMapping).filter(UrlMapping.token == token).first()
    if mapping is None:
        raise HTTPException(status_code=404, detail="Not Found")
    _raise_if_gone(mapping)

    redirect_cache[token] = mapping.original_url
    _record_scan(token, request, db)
    return RedirectResponse(mapping.original_url, status_code=302)


@app.get("/api/qr/{token}", response_model=QRInfoResponse)
def get_qr_info(token: str, db: Session = Depends(get_db)):
    mapping = _get_active_mapping(token, db)
    return mapping


@app.patch("/api/qr/{token}", response_model=QRInfoResponse)
def update_qr(token: str, req: UpdateRequest, db: Session = Depends(get_db)):
    mapping = _get_existing_mapping(token, db)
    if mapping.is_deleted:
        raise HTTPException(status_code=410, detail="Gone")

    if "url" in req.model_fields_set:
        if req.url is None:
            raise HTTPException(status_code=422, detail="URL cannot be null")
        mapping.original_url = _validate_request_url(req.url)
        redirect_cache.pop(token, None)

    if "expires_at" in req.model_fields_set:
        mapping.expires_at = _normalize_datetime(req.expires_at)
        redirect_cache.pop(token, None)

    db.commit()
    db.refresh(mapping)
    _raise_if_gone(mapping)
    return mapping


@app.delete("/api/qr/{token}")
def delete_qr(token: str, db: Session = Depends(get_db)):
    mapping = _get_existing_mapping(token, db)
    if mapping.is_deleted:
        raise HTTPException(status_code=410, detail="Gone")

    mapping.is_deleted = True
    db.commit()
    redirect_cache.pop(token, None)
    return {"detail": "Deleted"}


@app.get("/api/qr/{token}/image")
def get_qr_image(
    token: str,
    fg: str = "111111",
    bg: str = "ffffff",
    ecc: str = "M",
    format: str = "png",
    db: Session = Depends(get_db),
):
    _get_active_mapping(token, db)
    foreground = _normalize_hex_color(fg, "111111")
    background = _normalize_hex_color(bg, "ffffff")
    qr = qrcode.QRCode(
        error_correction=_error_correction(ecc),
        box_size=10,
        border=4,
    )
    qr.add_data(f"{BASE_URL}/r/{token}")
    qr.make(fit=True)

    buf = io.BytesIO()
    if format.lower() == "svg":
        img = qr.make_image(
            image_factory=SvgPathImage,
            fill_color=foreground,
            back_color=background,
        )
        img.save(buf)
        media_type = "image/svg+xml"
    else:
        img = qr.make_image(fill_color=foreground, back_color=background)
        img.save(buf, format="PNG")
        media_type = "image/png"

    buf.seek(0)
    return StreamingResponse(buf, media_type=media_type)


@app.get("/api/qr/{token}/analytics")
def get_analytics(token: str, db: Session = Depends(get_db)):
    _get_existing_mapping(token, db)
    total = db.query(func.count(ScanEvent.id)).filter(ScanEvent.token == token).scalar() or 0

    daily_rows = (
        db.query(
            func.date(ScanEvent.scanned_at).label("date"),
            func.count(ScanEvent.id).label("count"),
        )
        .filter(ScanEvent.token == token)
        .group_by(func.date(ScanEvent.scanned_at))
        .order_by(func.date(ScanEvent.scanned_at))
        .all()
    )

    return {
        "token": token,
        "total_scans": total,
        "scans_by_day": [
            {"date": str(row.date), "count": row.count} for row in daily_rows
        ],
    }


def _create_mapping_with_unique_token(
    original_url: str, expires_at: datetime | None, db: Session
) -> UrlMapping:
    for _ in range(MAX_RETRIES):
        mapping = UrlMapping(
            token=generate_token(db),
            original_url=original_url,
            expires_at=expires_at,
        )
        db.add(mapping)
        try:
            db.commit()
            db.refresh(mapping)
            return mapping
        except IntegrityError:
            db.rollback()

    raise HTTPException(status_code=500, detail="Could not generate a unique token")


def _get_existing_mapping(token: str, db: Session) -> UrlMapping:
    mapping = db.query(UrlMapping).filter(UrlMapping.token == token).first()
    if mapping is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return mapping


def _get_active_mapping(token: str, db: Session) -> UrlMapping:
    mapping = _get_existing_mapping(token, db)
    _raise_if_gone(mapping)
    return mapping


def _raise_if_gone(mapping: UrlMapping) -> None:
    if mapping.is_deleted or _is_expired(mapping):
        redirect_cache.pop(mapping.token, None)
        raise HTTPException(status_code=410, detail="Gone")


def _is_expired(mapping: UrlMapping) -> bool:
    return mapping.expires_at is not None and mapping.expires_at <= datetime.utcnow()


def _record_scan(token: str, request: Request, db: Session) -> None:
    db.add(
        ScanEvent(
            token=token,
            user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None,
        )
    )
    db.commit()


def _validate_request_url(url: str) -> str:
    try:
        return validate_url(url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _normalize_hex_color(value: str, fallback: str) -> str:
    clean = value.strip().removeprefix("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", clean):
        clean = fallback
    return f"#{clean.lower()}"


def _error_correction(value: str) -> int:
    levels = {
        "L": qrcode.constants.ERROR_CORRECT_L,
        "M": qrcode.constants.ERROR_CORRECT_M,
        "Q": qrcode.constants.ERROR_CORRECT_Q,
        "H": qrcode.constants.ERROR_CORRECT_H,
    }
    return levels.get(value.upper(), qrcode.constants.ERROR_CORRECT_M)
