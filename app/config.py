import os


BASE_URL = os.getenv("BASE_URL", "http://localhost:8000").rstrip("/")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./qr_code.db")
