"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  User,
  changePassword,
  getMe,
  hasToken,
  updateProfile,
} from "@/lib/api";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { notifyProfileUpdated } from "@/lib/socket";

/** Input de senha com botão de olho pra mostrar/ocultar o que foi digitado. */
function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label className="mt-2 text-xs font-medium text-ink-soft">{label}</label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          className="w-full rounded-card border border-surface-border bg-surface p-2 pr-9 text-sm text-ink outline-none transition-colors focus:border-brand-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-soft hover:text-brand-500"
        >
          {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>
    </>
  );
}

/**
 * Tela de perfil: trocar nome e trocar senha. Sem token salvo, redireciona
 * pro login — mesmo padrão de app/boards/page.tsx.
 */
export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameStatus, setNameStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<{ ok: boolean; message: string } | null>(
    null
  );

  useEffect(() => {
    if (!hasToken()) {
      router.replace("/");
      return;
    }
    getMe()
      .then(({ user }) => {
        setUser(user);
        setName(user.name);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/");
          return;
        }
        setLoadError("Não foi possível carregar seu perfil. Verifique sua conexão.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function handleBack() {
    // Volta pra tela de onde vieram (o board aberto, se foi de lá) em vez
    // de sempre mandar pra /boards — só cai nisso se a aba não tiver
    // histórico pra voltar (ex: link direto, sem navegação prévia).
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/boards");
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    setNameStatus(null);
    try {
      const { user } = await updateProfile(name.trim());
      setUser(user);
      notifyProfileUpdated();
      setNameStatus({ ok: true, message: "Nome atualizado." });
    } catch {
      setNameStatus({ ok: false, message: "Não foi possível salvar o nome." });
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordStatus(null);
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ ok: false, message: "A confirmação não bate com a nova senha." });
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordStatus({ ok: true, message: "Senha atualizada." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPasswordStatus({ ok: false, message: "Senha atual incorreta." });
      } else {
        setPasswordStatus({ ok: false, message: "Não foi possível trocar a senha." });
      }
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center bg-surface-muted text-sm text-ink-soft">
        Carregando...
      </main>
    );
  }

  if (loadError || !user) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-surface-muted p-4 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <Link href="/boards" className="text-sm text-brand-500 hover:underline">
          ← Voltar pros boards
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <h1 className="font-display text-xl font-bold text-ink">Perfil</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={handleBack}
            aria-label="Voltar"
            title="Voltar"
            className="flex h-8 w-8 items-center justify-center rounded-card border border-surface-border text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-500"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <section className="mb-6 rounded-card border border-surface-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 font-display text-sm font-semibold text-ink">Dados da conta</h2>
        <p className="mb-4 text-xs text-ink-soft">{user.email}</p>

        <form onSubmit={handleSaveName} className="flex flex-col gap-2">
          <label className="text-xs font-medium text-ink-soft">Nome</label>
          <input
            className="rounded-card border border-surface-border bg-surface p-2 text-sm text-ink outline-none transition-colors focus:border-brand-500"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            disabled={savingName}
            className="self-start rounded-card bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {savingName ? "Salvando..." : "Salvar nome"}
          </button>
          {nameStatus && (
            <p
              className={`text-xs ${
                nameStatus.ok ? "text-flow-600 dark:text-flow-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {nameStatus.message}
            </p>
          )}
        </form>
      </section>

      <section className="rounded-card border border-surface-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 font-display text-sm font-semibold text-ink">Trocar senha</h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-2">
          <PasswordField label="Senha atual" value={currentPassword} onChange={setCurrentPassword} />
          <PasswordField label="Nova senha" value={newPassword} onChange={setNewPassword} />
          <PasswordField
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
          <button
            type="submit"
            disabled={savingPassword}
            className="mt-2 self-start rounded-card bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {savingPassword ? "Salvando..." : "Trocar senha"}
          </button>
          {passwordStatus && (
            <p
              className={`text-xs ${
                passwordStatus.ok
                  ? "text-flow-600 dark:text-flow-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {passwordStatus.message}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
