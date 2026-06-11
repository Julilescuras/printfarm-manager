"""
OpenAI-compatible provider.

Groq, OpenAI and Google's paid/free Gemini endpoint all speak the OpenAI
Chat Completions format, so they share this one implementation — they differ
only by `base_url` + `api_key` + `model`. That is what makes migrating between
free Gemini/Groq and paid OpenAI a one-setting change.
"""

import json
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


class OpenAICompatProvider(LLMProvider):
    """Talks to any OpenAI-compatible /chat/completions endpoint."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str,
        name: str = "openai-compat",
        timeout: float = 60.0,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.name = name
        self.timeout = timeout

    # ── translation: our format → OpenAI wire format ────────────────────────
    @staticmethod
    def _encode_messages(messages: list[ChatMessage]) -> list[dict]:
        out: list[dict] = []
        for m in messages:
            if m.role == "assistant" and m.tool_calls:
                out.append({
                    "role": "assistant",
                    "content": m.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": json.dumps(tc.arguments, ensure_ascii=False),
                            },
                        }
                        for tc in m.tool_calls
                    ],
                })
            elif m.role == "tool":
                out.append({
                    "role": "tool",
                    "tool_call_id": m.tool_call_id,
                    "content": m.content or "",
                })
            else:
                out.append({"role": m.role, "content": m.content or ""})
        return out

    @staticmethod
    def _encode_tools(tools: Optional[list[ToolSpec]]) -> Optional[list[dict]]:
        if not tools:
            return None
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in tools
        ]

    # ── translation: OpenAI wire format → our format ────────────────────────
    @staticmethod
    def _decode_response(data: dict) -> LLMResponse:
        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError) as exc:
            raise LLMProviderError(f"Respuesta inesperada del modelo: {data}") from exc

        tool_calls: list[ToolCall] = []
        for raw in message.get("tool_calls") or []:
            fn = raw.get("function", {})
            raw_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(
                ToolCall(id=raw.get("id", ""), name=fn.get("name", ""), arguments=args)
            )

        return LLMResponse(content=message.get("content"), tool_calls=tool_calls)

    async def chat(
        self,
        messages: list[ChatMessage],
        tools: Optional[list[ToolSpec]] = None,
    ) -> LLMResponse:
        payload: dict = {
            "model": self.model,
            "messages": self._encode_messages(messages),
        }
        encoded_tools = self._encode_tools(tools)
        if encoded_tools:
            payload["tools"] = encoded_tools

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"No se pudo conectar al motor LLM: {exc}") from exc

        if resp.status_code != 200:
            raise LLMProviderError(
                f"Error del motor LLM ({self.name}) {resp.status_code}: {resp.text[:500]}"
            )

        return self._decode_response(resp.json())
