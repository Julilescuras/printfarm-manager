"""
Provider factory.

Reads the engine config from `app_settings` (so it's fully UI-configurable per
deployment — key to the commercial, multi-client use case) and builds the right
`LLMProvider`. Switching engines is just changing `assistant_provider` +
`assistant_api_key` in settings; no redeploy, no code change.
"""

import logging
from typing import Optional

from sqlalchemy import select

from app.database import async_session
from app.models.settings import AppSettings
from app.services.llm.anthropic import ANTHROPIC_API, AnthropicProvider
from app.services.llm.base import LLMProvider, LLMProviderError
from app.services.llm.openai_compat import OpenAICompatProvider

logger = logging.getLogger("printfarm.llm")

# Sensible per-provider defaults. The UI only needs to ask for the API key;
# base_url and model fall back to these unless the user overrides them.
PROVIDER_DEFAULTS: dict[str, dict] = {
    "gemini": {
        "kind": "openai",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.0-flash",
        "label": "Google Gemini (gratis)",
    },
    "groq": {
        "kind": "openai",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
        "label": "Groq / Llama (gratis)",
    },
    "openai": {
        "kind": "openai",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "label": "OpenAI (pago)",
    },
    "anthropic": {
        "kind": "anthropic",
        "base_url": ANTHROPIC_API,
        "model": "claude-haiku-4-5-20251001",
        "label": "Anthropic Claude (pago)",
    },
}

DEFAULT_PROVIDER = "gemini"


async def _load_settings() -> dict[str, str]:
    async with async_session() as session:
        result = await session.execute(select(AppSettings))
        return {s.key: s.value for s in result.scalars().all()}


def build_provider(
    provider: str,
    api_key: str,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> LLMProvider:
    """Construct a provider from explicit values (used by factory and tests)."""
    provider = (provider or DEFAULT_PROVIDER).strip().lower()
    defaults = PROVIDER_DEFAULTS.get(provider)
    if not defaults:
        raise LLMProviderError(
            f"Proveedor LLM desconocido: '{provider}'. "
            f"Opciones: {', '.join(PROVIDER_DEFAULTS)}"
        )
    if not api_key:
        raise LLMProviderError(
            f"Falta la API key para el proveedor '{provider}'. "
            f"Configurala en Ajustes → Asistente."
        )

    chosen_model = (model or "").strip() or defaults["model"]
    chosen_base = (base_url or "").strip() or defaults["base_url"]

    if defaults["kind"] == "anthropic":
        return AnthropicProvider(
            api_key=api_key, model=chosen_model, base_url=chosen_base, name=provider
        )
    return OpenAICompatProvider(
        api_key=api_key, model=chosen_model, base_url=chosen_base, name=provider
    )


async def get_provider() -> LLMProvider:
    """Build the provider configured in app_settings. Raises LLMProviderError
    if the assistant isn't configured yet."""
    cfg = await _load_settings()
    return build_provider(
        provider=cfg.get("assistant_provider", DEFAULT_PROVIDER),
        api_key=cfg.get("assistant_api_key", ""),
        model=cfg.get("assistant_model", ""),
        base_url=cfg.get("assistant_base_url", ""),
    )
