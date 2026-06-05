"use client";

import React, { useState, useEffect } from "react";
import { Video, Image as ImageIcon } from "lucide-react";
import { apiUrl } from "@/lib/api";
import type { PrinterState } from "@/lib/types";

/**
 * Shows the printer's live camera and/or the embedded G-code preview, with a
 * toggle when both are available. Used on the dashboard card and the detail
 * page. On the card it lives inside a <Link>, so toggle clicks stop propagation.
 */
export function PrinterMediaView({
  printer,
  heightClass = "h-40",
}: {
  printer: PrinterState;
  heightClass?: string;
}) {
  const hasCamera = !!printer.camera_url;
  // The manager can only build a preview for an active local print.
  const canPreview =
    printer.status === "printing" || printer.disconnected_while_printing;

  const [view, setView] = useState<"camera" | "preview">(
    hasCamera ? "camera" : "preview"
  );
  const [previewError, setPreviewError] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  // Re-try the preview whenever the printed file changes.
  useEffect(() => {
    setPreviewError(false);
  }, [printer.current_filename]);

  const previewSrc = apiUrl(
    `/api/printers/${printer.id}/thumbnail?f=${encodeURIComponent(
      printer.current_filename || ""
    )}`
  );

  const previewAvailable = canPreview && !previewError;
  const cameraAvailable = hasCamera && !cameraError;

  // Nothing to show at all.
  if (!previewAvailable && !cameraAvailable) return null;

  // Resolve which view to actually render given availability.
  let effectiveView: "camera" | "preview" = view;
  if (effectiveView === "camera" && !cameraAvailable) effectiveView = "preview";
  if (effectiveView === "preview" && !previewAvailable) effectiveView = "camera";

  const showToggle = previewAvailable && cameraAvailable;

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const tabClass = (active: boolean) =>
    `flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
      active
        ? "bg-card text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-2">
      {showToggle && (
        <div className="flex gap-1 p-0.5 bg-secondary/60 rounded-lg w-fit">
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              setView("camera");
            }}
            className={tabClass(effectiveView === "camera")}
          >
            <Video className="w-3 h-3" /> Cámara
          </button>
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              setView("preview");
            }}
            className={tabClass(effectiveView === "preview")}
          >
            <ImageIcon className="w-3 h-3" /> Preview
          </button>
        </div>
      )}

      <div
        className={`rounded-lg overflow-hidden bg-black ${heightClass} flex items-center justify-center`}
      >
        {effectiveView === "camera" && cameraAvailable ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={printer.camera_url!}
            alt="Cámara en vivo"
            className="w-full h-full object-contain"
            onError={() => setCameraError(true)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt="Previsualización del G-code"
            className="w-full h-full object-contain"
            onError={() => setPreviewError(true)}
          />
        )}
      </div>
    </div>
  );
}
