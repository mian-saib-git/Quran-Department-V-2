import logging
logger = logging.getLogger(__name__)
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser


class AcademyConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        user = self.scope.get("user")

        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4001)
            return

        self.user = user
        self.user_group = f"user_{user.id}"
        self.role_group = f"role_{user.role}"
        self.global_group = "global"

        # Join user-specific group, role group, and global group
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        await self.channel_layer.group_add(self.role_group, self.channel_name)
        await self.channel_layer.group_add(self.global_group, self.channel_name)

        await self.accept()

        # Send initial connection confirmation
        await self.send(text_data=json.dumps({
            "type": "connected",
            "message": "WebSocket connected.",
            "user_id": user.id,
            "role": user.role,
        }))

    async def disconnect(self, close_code):
        if hasattr(self, "user_group"):
            await self.channel_layer.group_discard(self.user_group, self.channel_name)
        if hasattr(self, "role_group"):
            await self.channel_layer.group_discard(self.role_group, self.channel_name)
        if hasattr(self, "global_group"):
            await self.channel_layer.group_discard(self.global_group, self.channel_name)

    async def receive(self, text_data):
        # Client can send ping to keep connection alive
        try:
            data = json.loads(text_data)
            if data.get("type") == "ping":
                await self.send(text_data=json.dumps({"type": "pong"}))
        except Exception as e:
            logger.warning("WebSocket consumer error: %s", e)

    # ── Event handlers (called by group_send) ──

    async def academy_update(self, event):
        """Generic update pushed to clients."""
        await self.send(text_data=json.dumps(event))

    async def lesson_saved(self, event):
        await self.send(text_data=json.dumps(event))

    async def permission_granted(self, event):
        await self.send(text_data=json.dumps(event))

    async def permission_disabled(self, event):
        await self.send(text_data=json.dumps(event))

    async def request_reviewed(self, event):
        await self.send(text_data=json.dumps(event))

    async def attendance_marked(self, event):
        await self.send(text_data=json.dumps(event))

    async def lesson_request_created(self, event):
        await self.send(text_data=json.dumps(event))