"""
The agent: a domain-agnostic tool-calling orchestrator.

It knows nothing about printers or inventory. It takes a natural-language
question, hands the model the registered tools, runs the tool-calling loop until
the model produces a final answer, and returns prose. Reusable as-is for any
future domain — only the registered tools change.
"""

import logging

# Importing the domain module registers its tools onto the shared registry.
from app.services.assistant import farm_tools  # noqa: F401
from app.services.assistant.registry import tool_registry
from app.services.llm.base import ChatMessage, LLMProviderError
from app.services.llm.factory import get_provider

logger = logging.getLogger("printfarm.assistant")

MAX_TOOL_ITERATIONS = 6

SYSTEM_PROMPT = """\
Sos el asistente de PrintFarm Manager, un sistema que gestiona una granja de \
impresoras 3D. Respondés en un grupo de Telegram a los operadores del taller.

Reglas:
- Respondé SIEMPRE en español rioplatense, de forma breve y clara (es un chat).
- Para cualquier dato sobre impresoras, bobinas/filamento, cola o mantenimiento, \
USÁ las herramientas disponibles. Nunca inventes números ni estados.
- Si una herramienta no devuelve datos o falla, decílo con naturalidad en vez de inventar.
- Podés combinar varias herramientas si hace falta para responder.
- No tenés capacidad de modificar nada todavía: solo consultás e informás. Si te \
piden pausar, despachar o vaciar una cama, aclará amablemente que por ahora solo \
podés dar información.
- Usá emojis con moderación cuando ayuden a la claridad (🖨️ 🧵 ⏳ ⚠️).
"""


class Assistant:
    """Answers a single question using the LLM + registered tools."""

    async def ask(self, question: str, *, allow_actions: bool = False) -> str:
        try:
            provider = await get_provider()
        except LLMProviderError as exc:
            return f"⚠️ El asistente no está configurado: {exc}"

        messages: list[ChatMessage] = [
            ChatMessage(role="system", content=SYSTEM_PROMPT),
            ChatMessage(role="user", content=question),
        ]
        tools = tool_registry.specs(include_actions=allow_actions)

        for _ in range(MAX_TOOL_ITERATIONS):
            try:
                response = await provider.chat(messages, tools)
            except LLMProviderError as exc:
                logger.warning("LLM call failed: %s", exc)
                return f"⚠️ No pude consultar al modelo: {exc}"

            if not response.wants_tools:
                return response.content or "No tengo una respuesta para eso."

            # Record the assistant's tool-call turn, then run each tool.
            messages.append(
                ChatMessage(
                    role="assistant",
                    content=response.content,
                    tool_calls=response.tool_calls,
                )
            )
            for call in response.tool_calls:
                logger.info("Assistant tool call: %s(%s)", call.name, call.arguments)
                result = await tool_registry.execute(call.name, call.arguments)
                messages.append(
                    ChatMessage(
                        role="tool",
                        tool_call_id=call.id,
                        name=call.name,
                        content=result,
                    )
                )

        return (
            "Necesité demasiados pasos para responder eso. "
            "Probá preguntándolo de forma más concreta."
        )


# Singleton
assistant = Assistant()
