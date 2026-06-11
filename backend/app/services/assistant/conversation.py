"""
Conversation memory + action authorization.

- `ConversationStore` keeps a short, per-chat rolling history so the assistant
  can handle follow-ups and natural confirmations ("¿seguro?" → "sí").
- The same store tracks the PIN "unlock": saying the action PIN unlocks actions
  for that user for a few minutes (like `sudo`), so they can confirm without
  repeating the PIN every time.

All in-memory and ephemeral on purpose — nothing security-sensitive is persisted.
"""

import time
from dataclasses import dataclass

HISTORY_TTL_SECS = 600   # forget conversation turns older than 10 min
HISTORY_MAX_TURNS = 12   # keep at most the last 12 turns per chat
PIN_TTL_SECS = 300       # an action PIN keeps actions unlocked for 5 min


@dataclass
class Actor:
    """Who is talking, and what they're allowed to do right now."""

    user_id: int
    name: str
    is_authorized: bool      # user_id is in the configured allow-list
    actions_unlocked: bool   # authorized AND a valid PIN was given recently

    @property
    def can_act(self) -> bool:
        return self.is_authorized and self.actions_unlocked


class ConversationStore:
    def __init__(self) -> None:
        # chat_id -> list of (role, content, timestamp)
        self._history: dict[int, list[tuple[str, str, float]]] = {}
        # (chat_id, user_id) -> expiry timestamp of the PIN unlock
        self._pin_until: dict[tuple[int, int], float] = {}

    # ── rolling history ──────────────────────────────────────────────────────
    def add(self, chat_id: int, role: str, content: str) -> None:
        now = time.time()
        turns = [t for t in self._history.get(chat_id, []) if now - t[2] < HISTORY_TTL_SECS]
        turns.append((role, content, now))
        self._history[chat_id] = turns[-HISTORY_MAX_TURNS:]

    def history(self, chat_id: int) -> list[tuple[str, str]]:
        """Recent (role, content) turns, oldest first, within the TTL window."""
        now = time.time()
        return [
            (role, content)
            for (role, content, ts) in self._history.get(chat_id, [])
            if now - ts < HISTORY_TTL_SECS
        ]

    # ── PIN unlock (sudo-style) ──────────────────────────────────────────────
    def unlock_actions(self, chat_id: int, user_id: int) -> None:
        self._pin_until[(chat_id, user_id)] = time.time() + PIN_TTL_SECS

    def actions_unlocked(self, chat_id: int, user_id: int) -> bool:
        return time.time() < self._pin_until.get((chat_id, user_id), 0.0)


# Singleton
conversation_store = ConversationStore()
