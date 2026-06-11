"""
Provider-agnostic LLM types and interface.

We keep a neutral message/tool representation here so the rest of the app never
depends on any vendor's wire format. Each concrete provider translates this
representation to and from its own API.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ToolSpec:
    """Declares a tool the model may call. `parameters` is a JSON Schema object."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class ToolCall:
    """A model's request to invoke a tool with parsed JSON arguments."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ChatMessage:
    """A single message in the conversation, in our neutral representation.

    role: "system" | "user" | "assistant" | "tool"
    - assistant messages may carry `tool_calls`
    - tool messages must carry `tool_call_id` and `name`
    """

    role: str
    content: Optional[str] = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: Optional[str] = None
    name: Optional[str] = None


@dataclass
class LLMResponse:
    """The model's reply for one turn: free text and/or tool calls."""

    content: Optional[str] = None
    tool_calls: list[ToolCall] = field(default_factory=list)

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


class LLMProviderError(Exception):
    """Raised when a provider call fails (network, auth, bad config...)."""


class LLMProvider(ABC):
    """Interface every engine implements. One method: run one chat turn."""

    #: Human label shown in logs / UI.
    name: str = "llm"

    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        tools: Optional[list[ToolSpec]] = None,
    ) -> LLMResponse:
        """Send the conversation (and available tools) and return one reply."""
        raise NotImplementedError

    async def transcribe(self, audio: bytes, filename: str, mime: str = "audio/ogg") -> str:
        """Transcribe an audio clip to text. Not every provider supports it."""
        raise LLMProviderError(
            f"El motor '{self.name}' no soporta transcripción de audio. "
            f"Usá Groq u OpenAI para mensajes de voz."
        )
