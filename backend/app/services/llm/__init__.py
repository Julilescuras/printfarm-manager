"""
LLM abstraction layer.

The assistant talks to a single `LLMProvider` interface; concrete providers
(Gemini, Groq, OpenAI, Anthropic) live behind it. Swapping the engine is a
settings change, never a code change — see `factory.get_provider()`.
"""

from app.services.llm.base import (
    ChatMessage,
    LLMProvider,
    LLMResponse,
    ToolCall,
    ToolSpec,
)
from app.services.llm.factory import get_provider

__all__ = [
    "ChatMessage",
    "LLMProvider",
    "LLMResponse",
    "ToolCall",
    "ToolSpec",
    "get_provider",
]
