from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

from app.database import Database
from app.task_service import TaskService

logger = logging.getLogger(__name__)


class TaskWorker:
    """Single-consumer worker: one GPU job at a time."""

    def __init__(
        self,
        db: Database,
        task_service: TaskService,
        poll_seconds: float = 0.5,
        hold_checker: Callable[[], bool] | None = None,
    ) -> None:
        self.db = db
        self.task_service = task_service
        self.poll_seconds = poll_seconds
        self._hold_checker = hold_checker or (lambda: False)
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        await self.task_service.recover_running_tasks()
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="task-worker")
        logger.info("Task worker started")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            await self._task
            self._task = None
        logger.info("Task worker stopped")

    async def _run(self) -> None:
        while not self._stop.is_set():
            # Hard lock: never start another GPU job while one is running.
            if self.db.count_running_tasks() > 0:
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self.poll_seconds)
                except asyncio.TimeoutError:
                    continue
                continue

            # Local hold: pause dequeuing so desktop ComfyUI keeps the GPU.
            if self._hold_checker():
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self.poll_seconds)
                except asyncio.TimeoutError:
                    continue
                continue

            queued = self.db.list_tasks_by_status("queued")
            if not queued:
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self.poll_seconds)
                except asyncio.TimeoutError:
                    continue
                continue

            task = queued[0]
            logger.info(
                "Worker picking task_id=%s (queue depth=%s)",
                task.task_id,
                len(queued),
            )
            await self.task_service.process_task(task)
