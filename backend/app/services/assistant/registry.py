"""
Generic tool registry.

A tool is a named, documented async function the LLM may call. The registry is
domain-agnostic on purpose: today it holds 3D-farm tools, tomorrow it can hold
warehouse-inventory tools, all behind the same agent. Each tool flags whether it
is an `is_action` (mutates state) so the agent can gate actions by permission —
the read-only phase simply never exposes action tools.
"""

import inspect
import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from app.services.llm.base import ToolSpec

logger = logging.getLogger("printfarm.assistant")

ToolHandler = Callable[..., Awaitable[Any]]


@dataclass
class Tool:
    spec: ToolSpec
    handler: ToolHandler
    is_action: bool
    domain: str


class ToolRegistry:
    """Holds tools and runs them by name."""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: Optional[dict[str, Any]] = None,
        *,
        is_action: bool = False,
        domain: str = "general",
    ):
        """Decorator that registers an async handler as a callable tool."""

        def decorator(fn: ToolHandler) -> ToolHandler:
            if name in self._tools:
                logger.warning("Tool '%s' is being redefined", name)
            spec = ToolSpec(
                name=name,
                description=description,
                parameters=parameters or {"type": "object", "properties": {}},
            )
            self._tools[name] = Tool(
                spec=spec, handler=fn, is_action=is_action, domain=domain
            )
            return fn

        return decorator

    def specs(self, *, include_actions: bool) -> list[ToolSpec]:
        """Tool specs the model is allowed to see. Actions are excluded unless
        explicitly included (and the caller is authorized)."""
        return [
            t.spec
            for t in self._tools.values()
            if include_actions or not t.is_action
        ]

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    async def execute(self, name: str, arguments: dict[str, Any]) -> str:
        """Run a tool by name and return a string result for the model.

        Always returns a string (never raises): tool failures are reported back
        to the model as text so it can explain the problem to the user.
        """
        tool = self._tools.get(name)
        if tool is None:
            return json.dumps({"error": f"Herramienta desconocida: {name}"})
        try:
            result = tool.handler(**(arguments or {}))
            if inspect.isawaitable(result):
                result = await result
            if isinstance(result, str):
                return result
            return json.dumps(result, ensure_ascii=False, default=str)
        except TypeError as exc:
            logger.warning("Bad arguments for tool '%s': %s", name, exc)
            return json.dumps({"error": f"Argumentos inválidos para {name}: {exc}"})
        except Exception as exc:  # noqa: BLE001 — surface any failure to the model
            logger.exception("Tool '%s' failed", name)
            return json.dumps({"error": f"Fallo al ejecutar {name}: {exc}"})


# Shared registry instance. Domain modules import this and register onto it.
tool_registry = ToolRegistry()
