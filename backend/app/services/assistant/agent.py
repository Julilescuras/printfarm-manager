"""
The agent: a domain-agnostic tool-calling orchestrator.

It takes a natural-language question, the recent conversation, and an `Actor`
(who is asking + what they may do), hands the model the allowed tools, runs the
tool-calling loop, and returns prose. Action tools are only offered when the
actor is authorized AND has unlocked actions — the model literally cannot see
them otherwise, so permissions are enforced in code, not by trusting the model.
"""

import logging
from typing import Optional

# Importing the domain modules registers their tools onto the shared registry.
from app.services.assistant import farm_tools  # noqa: F401
from app.services.assistant import action_tools  # noqa: F401
from app.services.assistant.conversation import Actor
from app.services.assistant.registry import tool_registry
from app.services.llm.base import ChatMessage, LLMProviderError
from app.services.llm.factory import get_provider

logger = logging.getLogger("printfarm.assistant")

MAX_TOOL_ITERATIONS = 6

SYSTEM_PROMPT = """\
Sos el asistente de PrintFarm Manager, un sistema que gestiona una granja de \
impresoras 3D. Respondés en un grupo de Telegram a los operadores del taller.

Reglas generales:
- Respondé SIEMPRE en español rioplatense, breve y claro (es un chat).
- Para cualquier dato (impresoras, bobinas/filamento, cola, mantenimiento) USÁ las \
herramientas. Nunca inventes números ni estados.
- Si una herramienta falla o no trae datos, decílo con naturalidad.
- Usá emojis con moderación cuando ayuden (🖨️ 🧵 ⏳ ⚠️ ✅).
"""

ACTIONS_ALLOWED_NOTE = """\
Acciones (modifican impresoras): el usuario actual ESTÁ habilitado para ejecutarlas.
- CONFIRMACIÓN OBLIGATORIA: antes de ejecutar CUALQUIER acción, describí en una \
frase exactamente qué vas a hacer y pedí confirmación. Recién cuando el usuario \
confirme (sí / dale / confirmo) en un mensaje, ejecutá la herramienta. Si en su \
último mensaje ya confirmó una acción que vos propusiste, ejecutala.
- Si el pedido es ambiguo (no queda claro qué impresora o material), preguntá antes.
- No reveles ni menciones la clave de acción.
"""

ACTIONS_BLOCKED_NOTE = """\
Acciones (modifican impresoras): el usuario actual NO está habilitado para ejecutarlas \
(no está autorizado o no dio la clave de acción vigente). Si pide pausar, despachar, \
precalentar, cancelar, etc., explicale amablemente que necesita estar autorizado y \
decir la clave de acción. NO reveles la clave. Las consultas de información sí podés \
responderlas con normalidad.
"""


class Assistant:
    """Answers one turn using the LLM + registered tools, honoring permissions."""

    async def ask(
        self,
        question: str,
        *,
        actor: Optional[Actor] = None,
        history: Optional[list[tuple[str, str]]] = None,
    ) -> str:
        try:
            provider = await get_provider()
        except LLMProviderError as exc:
            return f"⚠️ El asistente no está configurado: {exc}"

        can_act = bool(actor and actor.can_act)
        system = SYSTEM_PROMPT + "\n\n" + (ACTIONS_ALLOWED_NOTE if can_act else ACTIONS_BLOCKED_NOTE)

        messages: list[ChatMessage] = [ChatMessage(role="system", content=system)]
        for role, content in history or []:
            if role in ("user", "assistant") and content:
                messages.append(ChatMessage(role=role, content=content))
        messages.append(ChatMessage(role="user", content=question))

        tools = tool_registry.specs(include_actions=can_act)

        for _ in range(MAX_TOOL_ITERATIONS):
            try:
                response = await provider.chat(messages, tools)
            except LLMProviderError as exc:
                logger.warning("LLM call failed: %s", exc)
                return f"⚠️ No pude consultar al modelo: {exc}"

            if not response.wants_tools:
                return response.content or "No tengo una respuesta para eso."

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
            "Probá de nuevo de forma más concreta."
        )


# Singleton
assistant = Assistant()
