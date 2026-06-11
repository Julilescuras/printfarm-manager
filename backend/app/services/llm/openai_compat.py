"""
OpenAI-compatible provider.

Groq, OpenAI and Google's paid/free Gemini endpoint all speak the OpenAI
Chat Completions format, so they share this one implementation — they differ
only by `base_url` + `api_key` + `model`. That is what makes migrating between
free Gemini/Groq and paid OpenAI a one-setting change.
"""

import json
import logging
import re
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


# Speech-to-text model per provider (Whisper-compatible /audio/transcriptions).
TRANSCRIBE_MODELS = {
    "groq": "whisper-large-v3-turbo",
    "openai": "whisper-1",
}

# Groq's Llama models occasionally emit a tool call as plain text in a broken
# pseudo-format (e.g. `<function=nombre({"x": 1})</function>`) instead of the
# structured tool_calls field, and Groq rejects it with a 400 `tool_use_failed`
# returning the attempt in `failed_generation`. This recovers those.
_PSEUDO_CALL_RE = re.compile(r"<function=([A-Za-z0-9_]+)(.*?)</function>", re.DOTALL)
_JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)


def _recover_pseudo_tool_calls(failed_generation: str) -> list[ToolCall]:
    """Parse Groq's malformed `<function=name(args)</function>` text into ToolCalls."""
    calls: list[ToolCall] = []
    for idx, match in enumerate(_PSEUDO_CALL_RE.finditer(failed_generation or "")):
        name = match.group(1)
        inner = match.group(2) or ""
        args: dict = {}
        json_match = _JSON_OBJ_RE.search(inner)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                if isinstance(parsed, dict):
                    args = parsed
            except json.JSONDecodeError:
                args = {}
        calls.append(ToolCall(id=f"recovered_{idx}", name=name, arguments=args))
    return calls


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
            recovered = self._try_recover(resp)
            if recovered is not None:
                return recovered
            raise LLMProviderError(
                f"Error del motor LLM ({self.name}) {resp.status_code}: {resp.text[:500]}"
            )

        return self._decode_response(resp.json())

    @staticmethod
    def _try_recover(resp: httpx.Response) -> Optional[LLMResponse]:
        """If the model emitted a malformed tool call (Groq `tool_use_failed`),
        salvage it into a proper LLMResponse so the agent loop can continue."""
        try:
            err = resp.json().get("error", {})
        except (json.JSONDecodeError, ValueError, AttributeError):
            return None
        if err.get("code") != "tool_use_failed":
            return None
        calls = _recover_pseudo_tool_calls(err.get("failed_generation", ""))
        if not calls:
            return None
        logger.info("Recovered %d malformed tool call(s) from tool_use_failed", len(calls))
        return LLMResponse(content=None, tool_calls=calls)

    async def transcribe(self, audio: bytes, filename: str, mime: str = "audio/ogg") -> str:
        """Transcribe audio via the OpenAI-compatible /audio/transcriptions endpoint
        (Whisper). Works with Groq and OpenAI."""
        model = TRANSCRIBE_MODELS.get(self.name)
        if not model:
            raise LLMProviderError(
                f"El motor '{self.name}' no soporta mensajes de voz. Usá Groq u OpenAI."
            )
        headers = {"Authorization": f"Bearer {self.api_key}"}
        files = {"file": (filename, audio, mime)}
        data = {"model": model, "language": "es"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/audio/transcriptions",
                    headers=headers,
                    files=files,
                    data=data,
                )
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"No se pudo transcribir el audio: {exc}") from exc

        if resp.status_code != 200:
            raise LLMProviderError(
                f"Error al transcribir ({self.name}) {resp.status_code}: {resp.text[:300]}"
            )
        return (resp.json().get("text") or "").strip()
