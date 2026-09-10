"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, hasToken, login, register, saveToken } from "@/lib/api";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
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
      <div className="w-full max-w-md rounded-card border border-surface-border bg-surface p-10 shadow-card">
        <div className="mb-10 flex items-center justify-center gap-3">
          <Logo size={48} />
          <span className="font-display text-4xl font-bold text-ink">Fluxo</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "register" && (
            <input
              className="rounded-card border border-surface-border bg-surface p-3 text-base text-ink outline-none transition-colors focus:border-brand-500"
              placeholder="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            className="rounded-card border border-surface-border bg-surface p-3 text-base text-ink outline-none transition-colors focus:border-brand-500"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <div className="relative">
            <input
              className="w-full rounded-card border border-surface-border bg-surface p-3 pr-10 text-base text-ink outline-none transition-colors focus:border-brand-500"
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-brand-500"
            >
              {showPassword ? (
                <EyeOffIcon className="h-5 w-5" />
              ) : (
                <EyeIcon className="h-5 w-5" />
              )}
            </button>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-card bg-brand-500 p-3 text-base font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
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
          className="mt-5 w-full text-center text-sm text-ink-soft hover:text-brand-500"
        >
          {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
        </button>
      </div>
    </main>
  );
}
