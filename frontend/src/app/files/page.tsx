"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search, FolderOpen, ChevronRight, Download, Home, Loader2, FileX,
} from "lucide-react";
import { api } from "@/lib/api";
import type { BrowseResult, FileNode } from "@/lib/types";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";
import { GcodeThumbnail } from "@/components/files/gcode-thumbnail";

export default function FilesPage() {
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileNode[] | null>(null);
  const [searching, setSearching] = useState(false);

  const searching_mode = query.trim().length > 0;

  // ── Browse the current folder ──────────────────────────────────────────────
  const loadBrowse = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.browseFiles(p);
      setBrowse(data);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la carpeta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!searching_mode) loadBrowse(path);
  }, [path, searching_mode, loadBrowse]);

  // ── Debounced search ───────────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.searchFiles(q);
        setResults(data.files);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const enterFolder = (p: string) => {
    setQuery("");
    setPath(p);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-primary" />
            Archivos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Explorá y descargá los G-codes guardados por el manager.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar archivo..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-card/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {searching_mode ? (
        <SearchView query={query} results={results} searching={searching} />
      ) : (
        <BrowseView
          browse={browse}
          loading={loading}
          error={error}
          onEnterFolder={enterFolder}
        />
      )}
    </div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function Breadcrumbs({
  browse,
  onNavigate,
}: {
  browse: BrowseResult;
  onNavigate: (p: string) => void;
}) {
  return (
    <nav className="flex items-center flex-wrap gap-1 font-mono text-sm">
      {browse.breadcrumb.map((crumb, i) => {
        const isLast = i === browse.breadcrumb.length - 1;
        return (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />}
            <button
              onClick={() => !isLast && onNavigate(crumb.path)}
              disabled={isLast}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded",
                isLast
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {i === 0 && <Home className="w-3.5 h-3.5" />}
              {crumb.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

// ── Browse view ───────────────────────────────────────────────────────────────

function BrowseView({
  browse,
  loading,
  error,
  onEnterFolder,
}: {
  browse: BrowseResult | null;
  loading: boolean;
  error: string | null;
  onEnterFolder: (p: string) => void;
}) {
  if (error) {
    return <EmptyState icon={<FileX className="w-10 h-10" />} title="Error" subtitle={error} />;
  }
  if (loading && !browse) {
    return <ListSkeleton />;
  }
  if (!browse) return null;

  const empty = browse.folders.length === 0 && browse.files.length === 0;

  return (
    <div className="space-y-5">
      <Breadcrumbs browse={browse} onNavigate={onEnterFolder} />

      {empty ? (
        <EmptyState
          icon={<FolderOpen className="w-10 h-10" />}
          title="Carpeta vacía"
          subtitle="No hay archivos ni subcarpetas acá."
        />
      ) : (
        <>
          {browse.folders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {browse.folders.map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => onEnterFolder(folder.path)}
                  className="glass-card-hover p-4 text-left flex items-center gap-3"
                >
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-primary/15 flex items-center justify-center">
                    <FolderOpen className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{folder.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {folder.file_count} {folder.file_count === 1 ? "archivo" : "archivos"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {browse.files.length > 0 && (
            <div className="space-y-2">
              {browse.files.map((file) => (
                <FileRow key={file.path} file={file} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Search view ───────────────────────────────────────────────────────────────

function SearchView({
  query,
  results,
  searching,
}: {
  query: string;
  results: FileNode[] | null;
  searching: boolean;
}) {
  if (searching && !results) {
    return <ListSkeleton />;
  }
  if (results && results.length === 0) {
    return (
      <EmptyState
        icon={<Search className="w-10 h-10" />}
        title="Sin resultados"
        subtitle={`No hay archivos que coincidan con “${query.trim()}”.`}
      />
    );
  }
  if (!results) return null;

  return (
    <div className="space-y-2">
      <p className="font-mono text-xs text-muted-foreground">
        {results.length} resultado{results.length === 1 ? "" : "s"}
      </p>
      {results.map((file) => (
        <FileRow key={file.path} file={file} showPath />
      ))}
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({ file, showPath }: { file: FileNode; showPath?: boolean }) {
  return (
    <div className="glass-card flex items-center gap-3 p-3">
      <GcodeThumbnail
        src={api.fileThumbnailUrl(file.path)}
        className="w-12 h-12 shrink-0 rounded-lg border border-border"
        iconClassName="w-5 h-5"
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground truncate">{file.name}</div>
        <div className="font-mono text-xs text-muted-foreground truncate">
          {showPath ? file.path : `${formatBytes(file.size_bytes)} · ${formatDateTime(file.modified_at)}`}
        </div>
      </div>
      <a
        href={api.fileDownloadUrl(file.path)}
        download={file.name}
        className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        title="Descargar"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Descargar</span>
      </a>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="glass-card flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="text-muted-foreground/50 mb-3">{icon}</div>
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{subtitle}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="glass-card flex items-center gap-3 p-3 animate-pulse">
          <div className="w-12 h-12 rounded-lg bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 bg-white/10 rounded" />
            <div className="h-3 w-24 bg-white/10 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
