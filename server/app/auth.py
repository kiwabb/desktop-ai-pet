from dataclasses import dataclass
from hashlib import sha256

from .db import Database


@dataclass(frozen=True)
class Principal:
    account_id: str
    device_id: str
    roles: tuple[str, ...]


def token_hash(token: str) -> str:
    return sha256(token.encode()).hexdigest()


class Auth:
    def __init__(self, db: Database):
        self.db = db

    async def authenticate(self, authorization: str | None, role: str) -> Principal:
        if not authorization or not authorization.startswith("Bearer "):
            raise PermissionError("需要设备凭证")
        token = authorization[7:]
        if not token or len(token) > 512 or any(char.isspace() for char in token):
            raise PermissionError("设备凭证无效或已撤销")
        async with self.db.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT id,account_id,roles FROM devices WHERE token_hash=%s AND revoked_at IS NULL",
                (token_hash(token),),
            )).fetchone()
        if not row or role not in row["roles"]:
            raise PermissionError("设备凭证无效、已撤销或角色未授权")
        return Principal(str(row["account_id"]), str(row["id"]), tuple(row["roles"]))

    async def ensure_active(self, principal: Principal, role: str):
        async with self.db.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT roles FROM devices WHERE id=%s AND account_id=%s AND revoked_at IS NULL",
                (principal.device_id, principal.account_id),
            )).fetchone()
        if not row or role not in row["roles"]:
            raise PermissionError("设备凭证已撤销或角色未授权")
