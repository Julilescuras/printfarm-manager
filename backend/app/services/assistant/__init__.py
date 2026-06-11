"""
The conversational assistant.

Three decoupled pieces:
- `registry`  — a generic tool registry (reusable for any domain: 3D farm today,
                workshop inventory tomorrow).
- `agent`     — domain-agnostic orchestrator: LLM + tool-calling loop.
- `listener`  — Telegram transport (long-polling).

`farm_tools` registers the 3D-farm domain tools into the shared registry. To add
a new domain later you write a new `*_tools` module and import it — nothing else
changes.
"""
