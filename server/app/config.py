from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PET_AGENT_", env_file=".env", extra="ignore")

    database_url: str = Field(default="", repr=False)
    redis_url: str = Field(default="", repr=False)
    model_base_url: str = Field(default="https://api.openai.com/v1", repr=False)
    model_api_key: str = Field(default="", repr=False)
    model_name: str = ""
    model_timeout_seconds: int = Field(default=90, ge=5, le=600)
    max_agent_steps: int = Field(default=8, ge=1, le=64)
    gateway_id: str = Field(default_factory=lambda: str(uuid4()))
    worker_concurrency: int = Field(default=2, ge=1, le=16)

    # Admin credentials are deliberately separate from device credentials.
    admin_encryption_key: str = Field(default="", repr=False)
    admin_session_ttl_seconds: int = Field(default=8 * 60 * 60, ge=900, le=7 * 24 * 60 * 60)
    admin_cookie_secure: bool = False
    trace_payload_retention_days: int = Field(default=30, ge=1, le=3650)
    trace_metadata_retention_days: int = Field(default=90, ge=1, le=3650)

    default_timezone: str = "Asia/Shanghai"

    @field_validator("default_timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("默认时区必须为有效的 IANA 时区名称") from None
        return value

    @property
    def model_configured(self) -> bool:
        return bool(self.model_name.strip() and self.model_api_key.strip() and self.model_base_url.strip())
