from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import Settings


class Database:
    def __init__(self, settings: Settings):
        self.pool = AsyncConnectionPool(
            conninfo=settings.database_url, open=False, min_size=1,
            max_size=max(8, settings.worker_concurrency * 3), timeout=5,
            kwargs={"autocommit": True, "row_factory": dict_row,
                    "prepare_threshold": 0, "connect_timeout": 5},
        )

    async def open(self):
        await self.pool.open(wait=True, timeout=10)
        async with self.pool.connection() as conn:
            # Transaction-scoped lock serializes migrations across gateway processes.
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(718429103)")
                await conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
                for migration in sorted((Path(__file__).parent.parent / "migrations").glob("*.sql")):
                    found = await (await conn.execute("SELECT 1 FROM schema_migrations WHERE version=%s", (migration.name,))).fetchone()
                    if not found:
                        await conn.execute(migration.read_text(), prepare=False)
                        await conn.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (migration.name,))

    async def close(self):
        await self.pool.close()

    async def healthy(self) -> bool:
        try:
            async with self.pool.connection() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception:
            return False
