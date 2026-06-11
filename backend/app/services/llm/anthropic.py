"""
Anthropic (Claude) provider.

Claude's Messages API uses a different shape than OpenAI (system is a top-level
param, tool calls/results are content blocks), so it needs its own adapter —
but it sits behind the exact same `LLMProvider` interface, so the rest of the
app cannot tell the difference. This is the "migrate to Claude paid" path.
"""

import logging
from typing import Optional

import httpx

from app.services.llm.base import (
    ChatMessage,
    LLMProvider,
    LLMProviderError,
    LLMResponse,
    ToolCall,
    ToolSpec,
)

logger = logging.getLogger("printfarm.llm")

ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider(LLMProvider):
    """Talks to Claude via the Messages API."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = ANTHROPIC_API,
        max_tokens: int = 1024,
        name: str = "anthropic",
        timeout: float = 60.0,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        self.max_tokens = max_tokens
        self.name = name
        self.timeout = timeout

    def _encode(self, messages: list[ChatMessage]) -> tuple[str, list[dict]]:
        """Returns (system_prompt, messages) in Anthropic format.

        Consecutive `tool` messages are merged into a single user message so
        their tool_result blocks travel together, as Claude expects.
        """
        system_parts: list[str] = []
        out: list[dict] = []

        for m in messages:
            if m.role == "system":
                if m.content:
                    system_parts.append(m.content)
            elif m.role == "tool":
                block = {
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id,
                    "content": m.content or "",
                }
                if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                    out[-1]["content"].append(block)
                else:
                    out.append({"role": "user", "content": [block]})
            elif m.role == "assistant" and m.tool_calls:
                blocks: list[dict] = []
                if m.content:
                    blocks.append({"type": "text", "text": m.content})
                for tc in m.tool_calls:
                    blocks.append({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments,
                    })
                out.append({"role": "assistant", "content": blocks})
            else:
                out.append({"role": m.role, "content": m.content or ""})

        return "\n\n".join(system_parts), out

    @staticmethod
    def _encode_tools(tools: Optional[list[ToolSpec]]) -> Optional[list[dict]]:
        if not tools:
            return None
        return [
            {"name": t.name, "description": t.description, "input_schema": t.parameters}
            for t in tools
        ]

    @staticmethod
    def _decode(data: dict) -> LLMResponse:
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in data.get("content", []):
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.get("id", ""),
                        name=block.get("name", ""),
                        arguments=block.get("input", {}) or {},
                    )
                )
        content = "".join(text_parts) or None
        return LLMResponse(content=content, tool_calls=tool_calls)

    async def chat(
        self,
        messages: list[ChatMessage],
        tools: Optional[list[ToolSpec]] = None,
    ) -> LLMResponse:
        system_prompt, encoded_messages = self._encode(messages)
        payload: dict = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": encoded_messages,
        }
        if system_prompt:
            payload["system"] = system_prompt
        encoded_tools = self._encode_tools(tools)
        if encoded_tools:
            payload["tools"] = encoded_tools

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(self.base_url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"No se pudo conectar a Anthropic: {exc}") from exc

        if resp.status_code != 200:
            raise LLMProviderError(
                f"Error de Anthropic {resp.status_code}: {resp.text[:500]}"
            )

        return self._decode(resp.json())
