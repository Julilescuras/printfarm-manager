"use client";

import { useState, useEffect } from "react";
import { FileCode } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders the embedded preview of a stored G-code (the actual printed piece),
 * falling back to a G-code icon when the file has no thumbnail or can't load.
 *
 * `src` is a backend thumbnail URL (see api.fileThumbnailUrl /
 * api.historyThumbnailUrl). When null, only the fallback icon is shown.
 */
export function GcodeThumbnail({
  src,
  className,
  iconClassName,
}: {
  src: string | null;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Reset the failed flag when the src changes so a new file gets a fresh try.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = src && !failed;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-secondary/60",
        className
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Vista previa de la pieza"
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <FileCode className={cn("text-muted-foreground/50", iconClassName ?? "w-6 h-6")} />
      )}
    </div>
  );
}
