# QR Code Generator

A FastAPI prototype for dynamic QR codes and short links. Users can create a QR code from a long URL, scan the generated short URL, update the destination later, soft-delete links, set expiration timestamps, and view simple scan analytics.

The app also includes a lightweight SPA served by FastAPI at `/`.

## Features

- Create dynamic QR codes from target URLs
- Generate short links such as `http://localhost:8000/r/{token}`
- Redirect with `302` so updates, deletes, and analytics keep working
- Update a QR code's target URL and optional expiration timestamp
- Soft-delete QR codes
- Return `410 Gone` for deleted or expired links
- Return `404 Not Found` for tokens that never existed
- Generate QR code PNG images
- Track total scans and scans grouped by day
- Validate and normalize URLs before saving
- Block known malicious domains and private IP targets
- Use a SPA for create, preview, copy, download, update, delete, recent links, and analytics

## Tech Stack

- Python 3.10+
- FastAPI
- SQLAlchemy 2.x
- SQLite
- qrcode + Pillow
- Tailwind CDN single-file SPA

## Project Structure

```text
.
|-- app/
|   |-- config.py
|   |-- database.py
|   |-- main.py
|   |-- models.py
|   |-- schemas.py
|   |-- token_gen.py
|   `-- url_validator.py
|-- static/
|   `-- index.html
|-- scaffold/
|   `-- Guided-track reference implementation
|-- PROMPT.md
|-- requirements.txt
`-- README.md
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload
```

Open the SPA:

```text
http://localhost:8000
```

The SQLite database is created automatically as `qr_code.db`.

## Configuration

Optional environment variables:

```bash
BASE_URL="http://localhost:8000"
DATABASE_URL="sqlite:///./qr_code.db"
```

`BASE_URL` is used when returning short URLs and QR image URLs.

## API

### Create QR Code

```bash
curl -X POST http://localhost:8000/api/qr/create \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

Returns:

```json
{
  "token": "abc1234",
  "short_url": "http://localhost:8000/r/abc1234",
  "qr_code_url": "http://localhost:8000/api/qr/abc1234/image",
  "original_url": "https://example.com"
}
```

Create with expiration:

```bash
curl -X POST http://localhost:8000/api/qr/create \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "expires_at": "2030-01-01T00:00:00Z"}'
```

### Redirect

```bash
curl -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:8000/r/{token}
```

Expected active result: `302`.

### Get Info

```bash
curl http://localhost:8000/api/qr/{token}
```

### Update

```bash
curl -X PATCH http://localhost:8000/api/qr/{token} \
  -H "Content-Type: application/json" \
  -d '{"url": "https://new-url.com"}'
```

Remove expiration:

```bash
curl -X PATCH http://localhost:8000/api/qr/{token} \
  -H "Content-Type: application/json" \
  -d '{"expires_at": null}'
```

### Delete

```bash
curl -X DELETE http://localhost:8000/api/qr/{token}
```

### QR Image

```bash
curl -o qr.png http://localhost:8000/api/qr/{token}/image
```

### Analytics

```bash
curl http://localhost:8000/api/qr/{token}/analytics
```

Returns:

```json
{
  "token": "abc1234",
  "total_scans": 2,
  "scans_by_day": [
    { "date": "2026-05-06", "count": 2 }
  ]
}
```

## Verification Flow

After starting the server, this should pass end to end:

```bash
CREATE_RESPONSE=$(curl -s -X POST http://localhost:8000/api/qr/create \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}')

TOKEN=$(python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" <<< "$CREATE_RESPONSE")

curl -o /dev/null -w "redirect: %{http_code}\n" http://localhost:8000/r/$TOKEN
curl http://localhost:8000/api/qr/$TOKEN

curl -X PATCH http://localhost:8000/api/qr/$TOKEN \
  -H "Content-Type: application/json" \
  -d '{"url": "https://new-url.com"}'

curl -o /dev/null -w "updated redirect: %{redirect_url}\n" http://localhost:8000/r/$TOKEN
curl http://localhost:8000/api/qr/$TOKEN/analytics
curl -o /dev/null -w "image: %{http_code} %{content_type}\n" http://localhost:8000/api/qr/$TOKEN/image
curl -X DELETE http://localhost:8000/api/qr/$TOKEN
curl -o /dev/null -w "deleted: %{http_code}\n" http://localhost:8000/r/$TOKEN
curl -o /dev/null -w "missing: %{http_code}\n" http://localhost:8000/r/INVALID
```

Expected highlights:

- Active redirects return `302`
- Deleted or expired links return `410`
- Missing tokens return `404`
- QR image endpoint returns `200 image/png`

## Notes

- The root implementation is the Challenge Track prototype.
- `scaffold/` is kept as reference material for the Guided Track.
- This is a learning prototype, so it uses SQLite and an in-process redirect cache. A production version would typically move cache and analytics writes to external services such as Redis and a durable event pipeline.
