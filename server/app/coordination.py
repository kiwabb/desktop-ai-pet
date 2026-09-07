import json

from redis.asyncio import Redis
from redis.exceptions import RedisError

from .config import Settings


class Coordination:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.redis = Redis.from_url(settings.redis_url or "redis://127.0.0.1:6379/0", decode_responses=True, socket_connect_timeout=2, socket_timeout=2)

    async def open(self):
        # Redis failure degrades node availability; persisted control events still work.
        await self.healthy()

    async def close(self):
        await self.redis.aclose()

    async def healthy(self) -> bool:
        if not self.settings.redis_url:
            return False
        try:
            return bool(await self.redis.ping())
        except (RedisError, OSError):
            return False

    async def publish_session(self, account_id: str, session_id: str):
        if not self.settings.redis_url:
            return
        try:
            await self.redis.publish("pet-agent:session", json.dumps({"account_id": account_id, "session_id": session_id}))
        except (RedisError, OSError):
            pass  # Wakeup is best effort; the durable event/worker poll is authoritative.

    def lease_key(self, account_id: str, device_id: str) -> str:
        return f"pet-agent:node:{account_id}:{device_id}"

    async def register(self, principal, connection_id: str):
        if not self.settings.redis_url:
            raise RuntimeError("Redis 未配置，设备注册不可用")
        value = json.dumps({"connection_id": connection_id, "gateway_id": self.settings.gateway_id}, sort_keys=True)
        await self.redis.set(self.lease_key(principal.account_id, principal.device_id), value, ex=45)

    async def heartbeat(self, principal, connection_id: str) -> bool:
        script = "local v=redis.call('GET',KEYS[1]); if v and cjson.decode(v).connection_id==ARGV[1] then return redis.call('EXPIRE',KEYS[1],45) end; return 0"
        return bool(await self.redis.eval(script, 1, self.lease_key(principal.account_id, principal.device_id), connection_id))

    async def unregister(self, principal, connection_id: str):
        script = "local v=redis.call('GET',KEYS[1]); if v and cjson.decode(v).connection_id==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0"
        try:
            await self.redis.eval(script, 1, self.lease_key(principal.account_id, principal.device_id), connection_id)
        except (RedisError, OSError):
            pass
