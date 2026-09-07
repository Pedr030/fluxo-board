"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, hasToken, login, register, saveToken } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Landing / login-registro. Um formulário só, com toggle entre os dois modos.
 * Se já existe token salvo, redireciona direto pra /boards.
 */
export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (hasToken()) {
      router.replace("/boards");
    }
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } =
        mode === "login" ? await login(email, password) : await register(name, email, password);
      saveToken(token);
      router.push("/boards");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError("Confira os campos: email precisa ser válido e senha ter 6+ caracteres.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError("Já existe uma conta com esse email.");
      } else if (mode === "login") {
        setError("Email ou senha inválidos.");
      } else {
        setError("Não foi possível criar a conta. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm rounded-card border border-surface-border bg-surface p-8 shadow-card">
        <div className="mb-8 flex items-center justify-center gap-3">
          <Logo size={40} />
          <span className="font-display text-3xl font-bold text-ink">Fluxo</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "register" && (
            <input
              className="rounded-card border border-surface-border bg-surface p-2 text-sm text-ink outline-none transition-colors focus:border-brand-500"
              placeholder="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            className="rounded-card border border-surface-border bg-surface p-2 text-sm text-ink outline-none transition-colors focus:border-brand-500"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <div className="relative">
            <input
              className="w-full rounded-card border border-surface-border bg-surface p-2 pr-9 text-sm text-ink outline-none transition-colors focus:border-brand-500"
              type={showPassword ? "text" : "password"}
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-soft hover:text-brand-500"
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.94 10.94 0 0112 20c-6 0-10-6-10-8a17.6 17.6 0 014.22-4.94M9.9 4.24A9.12 9.12 0 0112 4c6 0 10 6 10 8a17.5 17.5 0 01-2.16 3.19M14.12 14.12a3 3 0 11-4.24-4.24" />
                  <path d="M1 1l22 22" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-card bg-brand-500 p-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === "login" ? "register" : "login");
          }}
          className="mt-4 w-full text-center text-sm text-ink-soft hover:text-brand-500"
        >
          {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
        </button>
      </div>
    </main>
  );
}
