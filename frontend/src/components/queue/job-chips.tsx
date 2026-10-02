import { FileText } from "lucide-react";

/** Chips de integración: pedido (order_ref) y prueba de biblioteca. */
export function JobChips({
  orderRef,
  isTest,
}: {
  orderRef?: string | null;
  isTest?: boolean;
}) {
  if (!orderRef && !isTest) return null;
  return (
    <>
      {orderRef && (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-400"
          title="Pedido de Control Ventas"
        >
          <FileText className="w-3 h-3" />
          {orderRef}
        </span>
      )}
      {isTest && (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400"
          title="Impresión de prueba de la biblioteca"
        >
          🧪 Prueba
        </span>
      )}
    </>
  );
}
