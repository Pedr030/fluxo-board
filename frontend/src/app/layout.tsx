import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Unbounded } from "next/font/google";
import "../styles/globals.css";
import { themeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Fluxo",
  description: "Kanban board colaborativo em tempo real",
};

// Ver docs/identidade-visual.html: Unbounded no wordmark/títulos, Inter no
// corpo, JetBrains Mono pra conteúdo técnico. Carregadas via next/font (self
// hosted, sem FOUC) e expostas como variável CSS — o tailwind.config.ts
// aponta font-sans/font-display/font-mono pra elas.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const unbounded = Unbounded({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-unbounded" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${unbounded.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Aplica a classe de tema antes do React hidratar — senão a página
            pisca no tema claro por uma fração de segundo mesmo com o SO (ou
            a escolha salva) em dark. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
