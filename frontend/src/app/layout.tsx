import type { Metadata } from "next";
import "./globals.css";
import { WebSocketProvider } from "@/providers/websocket-provider";
import { Sidebar } from "@/components/layout/sidebar";

export const metadata: Metadata = {
  title: "PrintFarm Manager — Granja de Impresión 3D",
  description:
    "Sistema centralizado de gestión para granja de impresión 3D con Moonraker, Spoolman y cola inteligente.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen overflow-hidden">
        <WebSocketProvider>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-6 lg:p-8">{children}</div>
            </main>
          </div>
        </WebSocketProvider>
      </body>
    </html>
  );
}
