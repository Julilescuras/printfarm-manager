"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Check,
  AlertCircle,
  Bot,
  MessageSquare,
  ExternalLink,
  Loader2,
  RefreshCw,
  Download,
  Search,
  GitCommit,
  Wrench,
  Sparkles,
  KeyRound,
  Cpu,
} from "lucide-react";
import { api } from "@/lib/api";
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { DangerZone } from "@/components/settings/danger-zone";

export default function SettingsPage() {
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [maintBlockDispatch, setMaintBlockDispatch] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // ── Assistant (conversational agent) state ────────────────────────────────
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [assistantProvider, setAssistantProvider] = useState("gemini");
  const [assistantApiKey, setAssistantApiKey] = useState("");
  const [assistantModel, setAssistantModel] = useState("");
  const [providers, setProviders] = useState<
    { id: string; label: string; default_model: string; paid: boolean }[]
  >([]);
  const [isTestingAssistant, setIsTestingAssistant] = useState(false);
  const [assistantTestStatus, setAssistantTestStatus] = useState<"idle" | "success" | "error">("idle");
  const [assistantTestMessage, setAssistantTestMessage] = useState("");

  // ── Update state ──────────────────────────────────────────────────────────
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadSettings();
    // Cargar versión actual desde /api/status (sin DNS externo, siempre disponible)
    api.getSystemStatus().then((d) => setCurrentVersion(d.version || "")).catch(() => {});
    api.getAssistantProviders().then((d) => setProviders(d.providers || [])).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setBotToken(data.telegram_bot_token || "");
      setChatId(data.telegram_chat_id || "");
      setTelegramEnabled(data.telegram_enabled === "true");
      setMaintBlockDispatch(data.maintenance_block_dispatch === "true");
      setAssistantEnabled(data.assistant_enabled === "true");
      setAssistantProvider(data.assistant_provider || "gemini");
      setAssistantApiKey(data.assistant_api_key || "");
      setAssistantModel(data.assistant_model || "");
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
        maintenance_block_dispatch: maintBlockDispatch ? "true" : "false",
        assistant_enabled: assistantEnabled ? "true" : "false",
        assistant_provider: assistantProvider,
        assistant_api_key: assistantApiKey,
        assistant_model: assistantModel,
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

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    try {
      const data = await api.checkUpdate();
      setUpdateInfo(data);
      if (!data.check_ok) setUpdateError(data.error || "Error al verificar actualizaciones");
    } catch (err: any) {
      setUpdateError(err.message || "Error de conexión");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!window.confirm("¿Querés actualizar el sistema ahora? El frontend se reiniciará en ~30s y el backend en ~60s.")) return;
    setIsUpdating(true);
    setUpdateLog([]);
    setUpdateError(null);

    try {
      await api.applyUpdate();
    } catch (err: any) {
      setUpdateError(err.message || "Error al iniciar la actualización");
      setIsUpdating(false);
      return;
    }

    // Poll progress every 3 seconds
    const maxPolls = 60; // 3 minutes max
    let polls = 0;
    pollRef.current = setInterval(async () => {
      polls++;
      try {
        const status = await api.getUpdateStatus();
        setUpdateLog(status.log || []);
        setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        if (!status.in_progress || polls >= maxPolls) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setIsUpdating(false);
          // Refresh update info
          const fresh = await api.checkUpdate();
          setUpdateInfo(fresh);
        }
      } catch {
        // Backend may be restarting — keep polling
      }
    }, 3000);
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

  const handleTestAssistant = async () => {
    // Persist first so the backend tests against what's on screen.
    setIsTestingAssistant(true);
    setAssistantTestStatus("idle");
    setAssistantTestMessage("");
    try {
      await handleSave();
      const result = await api.testAssistant();
      if (result.status === "ok") {
        setAssistantTestStatus("success");
        setAssistantTestMessage(result.message);
      } else {
        setAssistantTestStatus("error");
        setAssistantTestMessage(result.message);
      }
    } catch (err: any) {
      setAssistantTestStatus("error");
      setAssistantTestMessage(err.message || "Error al probar el asistente");
    } finally {
      setIsTestingAssistant(false);
    }
  };

  const currentProviderMeta = providers.find((p) => p.id === assistantProvider);

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
      <AppearancePanel />

      {/* System Update Section */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-emerald-400" />
          Actualización del Sistema
        </h2>

        {/* Version info — siempre visible */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Versión instalada:</span>
            <span className="font-mono font-semibold">{currentVersion || updateInfo?.current_version || "—"}</span>
          </div>
          {updateInfo?.installed_commit && (
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <GitCommit className="w-3 h-3" /> Commit instalado:
              </span>
              <span className="font-mono text-xs text-muted-foreground">{updateInfo.installed_commit}</span>
            </div>
          )}
        </div>

        {/* GitHub comparison info — solo cuando el check funcionó */}
        {updateInfo && updateInfo.check_ok && (
          <div className="space-y-2 text-sm">
            {updateInfo.latest_commit && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <GitCommit className="w-3 h-3" /> Último en GitHub:
                </span>
                <span className="font-mono text-xs text-muted-foreground">{updateInfo.latest_commit}</span>
              </div>
            )}
            {updateInfo.latest_message && (
              <div className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded-lg border border-border">
                {updateInfo.latest_message}
              </div>
            )}

            {/* Status badge */}
            {updateInfo.up_to_date === true && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
                <Check className="w-4 h-4 shrink-0" />
                El sistema está al día
              </div>
            )}
            {updateInfo.up_to_date === false && (
              <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                <Download className="w-4 h-4 shrink-0" />
                Hay una actualización disponible
              </div>
            )}
            {updateInfo.up_to_date === null && updateInfo.check_ok && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 border border-border rounded-lg p-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Primera vez — instalá el commit SHA con <code className="text-xs bg-secondary px-1 rounded">./update.sh</code>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {updateError && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {updateError}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleCheckUpdate}
            disabled={isCheckingUpdate || isUpdating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border font-medium text-sm hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {isCheckingUpdate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar actualizaciones
          </button>
          <button
            onClick={handleApplyUpdate}
            disabled={isUpdating || isCheckingUpdate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium text-sm hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isUpdating ? "Actualizando..." : "Actualizar ahora"}
          </button>
        </div>

        {/* Progress log */}
        {updateLog.length > 0 && (
          <div className="bg-black/40 border border-border rounded-lg p-3 max-h-44 overflow-y-auto">
            <p className="text-xs text-muted-foreground mb-2 font-semibold">Progreso:</p>
            {updateLog.map((line, i) => (
              <div
                key={i}
                className={`text-xs font-mono leading-5 ${
                  line.startsWith("✓") ? "text-emerald-400" :
                  line.startsWith("✗") || line.startsWith("ERROR") ? "text-red-400" :
                  line.startsWith("⚠") ? "text-amber-400" :
                  "text-muted-foreground"
                }`}
              >
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Info box */}
        <div className="p-3 rounded-lg bg-secondary/50 border border-border text-xs text-muted-foreground">
          Las imágenes se compilan automáticamente en GitHub Actions al hacer push. La actualización descarga la imagen pre-compilada (~2-3 min en lugar de 25 min).
        </div>
      </div>

      {/* Maintenance dispatch behavior */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="w-5 h-5 text-amber-400" />
          Mantenimiento y Despacho
        </h2>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Bloquear despacho por alertas de mantenimiento</p>
            <p className="text-sm text-muted-foreground">
              {maintBlockDispatch
                ? "Modo bloqueo: una impresora con una alerta de mantenimiento activa no recibirá trabajos nuevos hasta que resetees ese mantenimiento. La impresión en curso nunca se interrumpe."
                : "Modo solo alertas: se notifica el mantenimiento, pero la impresora sigue aceptando trabajos automáticamente."}
            </p>
          </div>
          <button
            onClick={() => setMaintBlockDispatch(!maintBlockDispatch)}
            className="relative w-14 min-w-[3.5rem] h-7 rounded-full transition-colors duration-300 focus:outline-none shrink-0"
            style={{
              backgroundColor: maintBlockDispatch ? "hsl(var(--primary))" : "hsl(var(--muted))",
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300"
              style={{
                transform: maintBlockDispatch ? "translateX(28px)" : "translateX(0px)",
              }}
            />
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saveStatus === "success" ? "¡Guardado!" : "Guardar"}
        </button>
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
            className="relative w-14 min-w-[3.5rem] h-7 rounded-full transition-colors duration-300 focus:outline-none shrink-0"
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

      {/* Assistant Section — conversational agent in the Telegram group */}
      <div className="glass-card p-6 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-400" />
          Asistente del grupo (IA)
        </h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Permite preguntarle al bot en lenguaje natural dentro del grupo de Telegram
          (estado de impresoras, filamento, cola, mantenimiento). Usa el mismo Bot Token
          y Chat ID configurados arriba.
        </p>

        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Habilitar asistente</p>
            <p className="text-sm text-muted-foreground">
              El bot escucha el grupo y responde preguntas (por ahora, solo consultas)
            </p>
          </div>
          <button
            onClick={() => setAssistantEnabled(!assistantEnabled)}
            className="relative w-14 min-w-[3.5rem] h-7 rounded-full transition-colors duration-300 focus:outline-none shrink-0"
            style={{
              backgroundColor: assistantEnabled ? "hsl(var(--primary))" : "hsl(var(--muted))",
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300"
              style={{
                transform: assistantEnabled ? "translateX(28px)" : "translateX(0px)",
              }}
            />
          </button>
        </div>

        {/* Provider selector */}
        <div>
          <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5">
            <Cpu className="w-4 h-4" />
            Motor (proveedor de IA)
          </label>
          <select
            value={assistantProvider}
            onChange={(e) => setAssistantProvider(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            {currentProviderMeta?.paid
              ? "Proveedor pago — necesitás una cuenta con saldo."
              : "Gratis — generá una API key sin tarjeta."}{" "}
            Cambiar de motor no requiere reinstalar nada.
          </p>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5">
            <KeyRound className="w-4 h-4" />
            API Key
          </label>
          <input
            type="password"
            value={assistantApiKey}
            onChange={(e) => setAssistantApiKey(e.target.value)}
            placeholder="Pegá la API key del proveedor elegido"
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm font-mono"
          />
        </div>

        {/* Model (optional) */}
        <div>
          <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5">
            <Bot className="w-4 h-4" />
            Modelo <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            value={assistantModel}
            onChange={(e) => setAssistantModel(e.target.value)}
            placeholder={currentProviderMeta?.default_model || "modelo por defecto"}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Dejalo vacío para usar el recomendado: <code className="bg-secondary px-1 rounded">{currentProviderMeta?.default_model || "—"}</code>
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saveStatus === "success" ? "¡Guardado!" : "Guardar"}
          </button>
          <button
            onClick={handleTestAssistant}
            disabled={isTestingAssistant || !assistantApiKey}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white font-medium text-sm hover:bg-violet-500 transition-colors disabled:opacity-50"
          >
            {isTestingAssistant ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Probar conexión
          </button>
        </div>

        {/* Test result */}
        {assistantTestMessage && (
          <div
            className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
              assistantTestStatus === "success"
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            {assistantTestStatus === "success" ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {assistantTestMessage}
          </div>
        )}

        {/* Instructions */}
        <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            💬 ¿Cómo usarlo en el grupo?
          </h3>
          <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              Para la opción gratis (<strong>Gemini</strong>), generá tu API key en{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                Google AI Studio <ExternalLink className="w-3 h-3" />
              </a>{" "}
              (no pide tarjeta), pegala arriba y guardá.
            </li>
            <li>
              En el grupo, escribile al bot con{" "}
              <code className="bg-secondary px-1 rounded">/pregunta</code> seguido de tu
              consulta, mencionándolo con <code className="bg-secondary px-1 rounded">@tubot</code>,
              o respondiendo a uno de sus mensajes.
            </li>
            <li>
              Ejemplos: <em>«/pregunta ¿qué impresoras están andando?»</em> ·{" "}
              <em>«¿cuánto le queda a la bobina negra?»</em> · <em>«¿qué hay en la cola?»</em>
            </li>
            <li>
              Para que responda a cualquier mensaje sin comando, desactivá el{" "}
              <em>privacy mode</em> del bot en{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                @BotFather <ExternalLink className="w-3 h-3" />
              </a>{" "}
              (<code className="bg-secondary px-1 rounded">/setprivacy → Disable</code>).
            </li>
          </ul>
        </div>
      </div>

      {/* Danger Zone — hidden/collapsed, with typed confirmation */}
      <DangerZone />
    </div>
  );
}
