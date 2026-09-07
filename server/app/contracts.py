from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    v: Literal[1]
    type: str = Field(min_length=1, max_length=64)
    request_id: str | None = None
    session_id: str | None = None
    run_id: str | None = None
    seq: int | None = Field(default=None, ge=0)
    payload: dict[str, Any]

    @field_validator("v", mode="before")
    @classmethod
    def integer_version(cls, value):
        # Literal[1] otherwise accepts True and 1.0 by Python equality,
        # even with strict mode, unlike the Rust integer protocol decoder.
        if type(value) is not int:
            raise ValueError("协议版本必须为整数")
        return value


def uuid_string(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} 必须为 UUID")
    try:
        return str(UUID(value))
    except ValueError:
        raise ValueError(f"{field} 必须为 UUID") from None


def envelope(kind: str, payload: dict, **identifiers) -> dict:
    return {"v": 1, "type": kind, "payload": payload, **identifiers}


def protocol_error(code: str, message: str, request_id: str | None = None) -> dict:
    return envelope("protocol.error", {"code": code, "message": message}, request_id=request_id)


class ReminderConflict(Exception):
    """The displayed reminder is stale or the todo is completed."""


def reminder_time(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("提醒时间必须为带时区的 ISO 时间或 null")
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise ValueError("提醒时间必须为有效的带时区 ISO 时间") from None


def reminder_arguments(value: object) -> tuple[datetime | None, datetime | None]:
    if not isinstance(value, dict) or set(value) != {"remind_at", "expected_remind_at"}:
        raise ValueError("必须且只能提供 remind_at 和 expected_remind_at")
    return reminder_time(value["remind_at"]), reminder_time(value["expected_remind_at"])
