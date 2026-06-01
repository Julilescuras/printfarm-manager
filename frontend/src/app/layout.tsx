import type { Metadata } from "next";
import "./globals.css";
import { WebSocketProvider } from "@/providers/websocket-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "PrintFarm Manager — Granja de Impresión 3D",
  description:
    "Sistema centralizado de gestión para granja de impresión 3D con Moonraker, Spoolman y cola inteligente.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1525",
};

// Runs before first paint to apply the saved appearance and avoid a flash of
// the wrong theme (FOUC). Mirrors applyConfig() in theme-provider.tsx.
const themeInitScript = `(function(){try{
var d=document.documentElement;
var cfg={theme:'midnight',accent:'default',radius:'default',density:'comfortable',animations:true};
var raw=localStorage.getItem('printfarm-appearance');
if(raw){try{var p=JSON.parse(raw);for(var k in p){if(p[k]!=null)cfg[k]=p[k];}}catch(e){}}
else if(localStorage.getItem('printfarm-theme')==='light'){cfg.theme='daylight';}
var darks={midnight:1,nord:1,cyberpunk:1,forest:1};
d.setAttribute('data-theme',cfg.theme);
darks[cfg.theme]?d.classList.add('dark'):d.classList.remove('dark');
var ac={emerald:['142 71% 45%','0 0% 100%'],blue:['217 91% 60%','0 0% 100%'],violet:['262 83% 62%','0 0% 100%'],rose:['340 82% 58%','0 0% 100%'],amber:['38 92% 50%','30 25% 12%'],cyan:['189 94% 43%','200 50% 8%'],terracotta:['16 60% 56%','0 0% 100%']}[cfg.accent];
if(ac){d.style.setProperty('--primary',ac[0]);d.style.setProperty('--ring',ac[0]);d.style.setProperty('--primary-foreground',ac[1]);}
d.style.setProperty('--radius',{sharp:'0.25rem',default:'0.75rem',round:'1.25rem'}[cfg.radius]||'0.75rem');
d.style.fontSize=cfg.density==='compact'?'14px':'16px';
if(cfg.animations===false)d.classList.add('motion-reduced');
}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark" data-theme="midnight" suppressHydrationWarning>
      <body className="min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider>
          <WebSocketProvider>
            <AppShell>{children}</AppShell>
          </WebSocketProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
