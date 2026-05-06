import ipaddress
from urllib.parse import ParseResult, urlparse, urlunparse


MAX_URL_LENGTH = 2048
BLOCKED_DOMAINS = {
    "evil.com",
    "malware.example.com",
    "phishing.example.com",
}


def validate_url(raw_url: str) -> str:
    if not isinstance(raw_url, str):
        raise ValueError("URL must be a string")

    url = raw_url.strip()
    if not url:
        raise ValueError("URL is required")
    if len(url) > MAX_URL_LENGTH:
        raise ValueError("URL is too long")
    if any(ord(ch) < 32 for ch in url):
        raise ValueError("URL contains control characters")

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL scheme must be http or https")
    if not parsed.hostname:
        raise ValueError("URL must include a hostname")

    hostname = parsed.hostname.lower()
    if _is_blocked_host(hostname):
        raise ValueError("URL host is blocked")

    scheme = "https" if parsed.scheme == "http" else parsed.scheme
    netloc = _normalize_netloc(parsed, hostname, parsed.scheme)
    path = "" if parsed.path in {"", "/"} else parsed.path

    normalized = ParseResult(
        scheme=scheme,
        netloc=netloc,
        path=path,
        params=parsed.params,
        query=parsed.query,
        fragment="",
    )
    return urlunparse(normalized)


def _normalize_netloc(parsed: ParseResult, hostname: str, original_scheme: str) -> str:
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("URL port is invalid") from exc

    if port and not (
        (original_scheme == "http" and port == 80)
        or (original_scheme == "https" and port == 443)
    ):
        host = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
        return f"{host}:{port}"

    return f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname


def _is_blocked_host(hostname: str) -> bool:
    if hostname in BLOCKED_DOMAINS or any(
        hostname.endswith(f".{domain}") for domain in BLOCKED_DOMAINS
    ):
        return True

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return False

    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
