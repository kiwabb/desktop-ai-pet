from psycopg.types.json import Jsonb

from .db import Database


class Registry:
    def __init__(self, db: Database):
        self.db = db

    async def register_server_tools(self):
        from .todo_tools import TOOL_DEFINITIONS, TOOL_HANDLERS
        async with self.db.pool.connection() as conn:
            async with conn.transaction():
                for tool in TOOL_DEFINITIONS:
                    name = tool["name"]
                    handler = TOOL_HANDLERS[name]
                    await conn.execute(
                        "INSERT INTO tool_definitions(name,version,description,input_schema,permission,execution_location) VALUES (%s,%s,%s,%s,%s,'server') ON CONFLICT(name,version) DO UPDATE SET description=excluded.description,input_schema=excluded.input_schema,permission=excluded.permission",
                        (name, tool["version"], tool["description"], Jsonb(tool["input_schema"]), tool["permission"]),
                    )
                    await conn.execute(
                        "INSERT INTO tool_instances(instance_id,tool_name,tool_version,handler_key) VALUES (%s,%s,%s,%s) ON CONFLICT(instance_id) DO UPDATE SET tool_version=excluded.tool_version,handler_key=excluded.handler_key",
                        (f"server:{name}", name, tool["version"], handler),
                    )

    async def resolve_server(self, name: str) -> str:
        from .todo_tools import TOOL_HANDLERS
        if name not in TOOL_HANDLERS:
            raise ValueError("工具未注册")
        async with self.db.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT i.handler_key FROM tool_instances i JOIN tool_definitions d ON d.name=i.tool_name AND d.version=i.tool_version WHERE i.instance_id=%s AND i.device_id IS NULL AND d.execution_location='server'",
                (f"server:{name}",),
            )).fetchone()
        if not row or row["handler_key"] != TOOL_HANDLERS[name]:
            raise LookupError("工具执行实例不可用")
        return row["handler_key"]

    def validate_capabilities(self, capabilities: object):
        if not isinstance(capabilities, list) or capabilities:
            raise ValueError("当前版本未开放设备操作能力，capabilities 必须为空数组")
