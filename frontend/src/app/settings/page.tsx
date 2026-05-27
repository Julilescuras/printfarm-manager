"use client";

import React, { useState, useEffect } from "react";
import {
  Sun,
  Moon,
  Send,
  Check,
  AlertCircle,
  Bot,
  MessageSquare,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/providers/theme-provider";

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setBotToken(data.telegram_bot_token || "");
      setChatId(data.telegram_chat_id || "");
      setTelegramEnabled(data.telegram_enabled === "true");
    } catch (err) {
      console.error("Error loading settings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("idle");
    try {
      await api.updateSettings({
        telegram_bot_token: botToken,
        telegram_chat_id: chatId,
        telegram_enabled: telegramEnabled ? "true" : "false",
      });
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    setIsTesting(true);
    setTestStatus("idle");
    setTestMessage("");
    try {
      const result = await api.testTelegram();
      if (result.status === "ok") {
        setTestStatus("success");
        setTestMessage(result.message);
      } else {
        setTestStatus("error");
        setTestMessage(result.message);
      }
    } catch (err: any) {
      setTestStatus("error");
      setTestMessage(err.message || "Error al enviar mensaje de prueba");
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gradient">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Personaliza el comportamiento del sistema
        </p>
      </div>

      {/* Appearance Section */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          {theme === "dark" ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-amber-400" />}
          Apariencia
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Modo {theme === "dark" ? "Oscuro" : "Claro"}</p>
            <p className="text-sm text-muted-foreground">
              Cambiá entre el tema oscuro y claro
            </p>
          </div>
          <button
            onClick={toggleTheme}
            className="relative w-14 min-w-[3.5rem] h-7 rounded-full transition-colors duration-300 focus:outline-none shrink-0 overflow-hidden"
            style={{
              backgroundColor: theme === "dark" ? "hsl(var(--primary))" : "hsl(var(--muted))",
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 flex items-center justify-center"
              style={{
                transform: theme === "dark" ? "translateX(28px)" : "translateX(0px)",
              }}
            >
              {theme === "dark" ? (
                <Moon className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-amber-500" />
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Telegram Section */}
      <div className="glass-card p-6 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Send className="w-5 h-5 text-blue-400" />
          Notificaciones de Telegram
        </h2>

        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Habilitar notificaciones</p>
            <p className="text-sm text-muted-foreground">
              Recibí alertas de impresión y mantenimiento en Telegram
            </p>
          </div>
          <button
            onClick={() => setTelegramEnabled(!telegramEnabled)}
            className="relative w-14 min-w-[3.5rem] h-7 rounded-full transition-colors duration-300 focus:outline-none shrink-0 overflow-hidden"
            style={{
              backgroundColor: telegramEnabled ? "hsl(var(--primary))" : "hsl(var(--muted))",
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300"
              style={{
                transform: telegramEnabled ? "translateX(28px)" : "translateX(0px)",
              }}
            />
          </button>
        </div>

        {/* Bot Token */}
        <div>
          <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5">
            <Bot className="w-4 h-4" />
            Bot Token
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm font-mono"
          />
        </div>

        {/* Chat ID */}
        <div>
          <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4" />
            Chat ID del grupo
          </label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-1001234567890"
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm font-mono"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saveStatus === "success" ? (
              <Check className="w-4 h-4" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {saveStatus === "success" ? "¡Guardado!" : "Guardar"}
          </button>
          <button
            onClick={handleTestTelegram}
            disabled={isTesting || !botToken || !chatId}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Enviar prueba
          </button>
        </div>

        {/* Test result */}
        {testMessage && (
          <div
            className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
              testStatus === "success"
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            {testStatus === "success" ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {testMessage}
          </div>
        )}

        {/* Instructions */}
        <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            📖 ¿Cómo configurar Telegram?
          </h3>
          <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
            <li>
              Abrí Telegram y buscá{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                @BotFather <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>Enviá <code className="bg-secondary px-1 rounded">/newbot</code> y seguí los pasos para crear un bot</li>
            <li>Copiá el <strong>Token</strong> que te da BotFather y pegalo arriba</li>
            <li>
              Creá un <strong>grupo</strong> en Telegram e invitá al bot que acabás de crear
            </li>
            <li>
              Para obtener el <strong>Chat ID</strong> del grupo, agregá al bot{" "}
              <a
                href="https://t.me/RawDataBot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                @RawDataBot <ExternalLink className="w-3 h-3" />
              </a>{" "}
              al grupo — te mostrará el Chat ID (un número negativo que empieza con -100...)
            </li>
            <li>Pegá el Chat ID arriba, activá las notificaciones y dale a <strong>Guardar</strong></li>
            <li>Probá con el botón <strong>Enviar prueba</strong> para verificar que funcione</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
