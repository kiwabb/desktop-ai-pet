"""Explicit administrative provisioning. Never auto-create accounts at startup."""
import argparse
import asyncio
import json
import os
import secrets
from uuid import UUID, uuid4

from .auth import token_hash
from .config import Settings
from .db import Database


async def run(args):
    settings = Settings()
    if not settings.database_url:
        raise ValueError("PET_AGENT_DATABASE_URL 未配置")
    db = Database(settings)
    try:
        await db.open()
        async with db.pool.connection() as conn:
            if args.command == "migrate":
                print("数据库迁移完成")
            elif args.command == "create-account":
                account_id = str(uuid4())
                await conn.execute("INSERT INTO accounts(id,name) VALUES (%s,%s)", (account_id, args.name))
                print(json.dumps({"account_id": account_id}, ensure_ascii=False))
            elif args.command == "create-device":
                account_id = str(UUID(args.account_id))
                device_id, token = str(uuid4()), secrets.token_urlsafe(48)
                # Exclusive private file avoids overwriting credentials or printing them.
                credential_path = args.output or args.token_file
                descriptor = os.open(credential_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                try:
                    async with conn.transaction():
                        await conn.execute("INSERT INTO devices(id,account_id,name,token_hash,roles) VALUES (%s,%s,%s,%s,%s)",
                                           (device_id, account_id, args.name, token_hash(token), args.roles))
                        with os.fdopen(descriptor, "w") as output:
                            descriptor = None
                            output.write(json.dumps({"base_url": args.base_url, "device_token": token, "device_id": device_id, "account_id": account_id}) + "\n" if args.output else token + "\n")
                except Exception:
                    if descriptor is not None:
                        os.close(descriptor)
                    os.unlink(credential_path)
                    raise
                print(json.dumps({"account_id": account_id, "device_id": device_id, "credential_file": credential_path}))
            elif args.command == "revoke-device":
                row = await (await conn.execute("UPDATE devices SET revoked_at=now() WHERE id=%s RETURNING id", (str(UUID(args.device_id)),))).fetchone()
                if not row:
                    raise LookupError("设备不存在")
                print("设备已撤销；存量连接将在下一次认证检查时关闭（最长约 1 秒，不含数据库故障等待）")
    finally:
        await db.close()


def main():
    parser = argparse.ArgumentParser(description="桌面助手服务管理")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    account = commands.add_parser("create-account")
    account.add_argument("--name", required=True)
    device = commands.add_parser("create-device")
    device.add_argument("--account-id", required=True)
    device.add_argument("--name", required=True)
    device.add_argument("--roles", nargs="+", choices=["control", "node"], default=["control", "node"])
    destination = device.add_mutually_exclusive_group(required=True)
    destination.add_argument("--token-file")
    destination.add_argument("--output")
    device.add_argument("--base-url", default="http://127.0.0.1:18081")
    revoke = commands.add_parser("revoke-device")
    revoke.add_argument("--device-id", required=True)
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except Exception:
        parser.exit(1, "管理操作失败；请检查数据库连接、标识和凭证文件路径（敏感详情不输出）。\n")


if __name__ == "__main__":
    main()
