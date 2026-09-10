"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  User,
  changePassword,
  getMe,
  hasToken,
  removeAvatar,
  updateAvatar,
  updateProfile,
} from "@/lib/api";
import { AccountDeletionSection } from "@/components/AccountDeletionSection";
import { Avatar } from "@/components/Avatar";
import { ArrowLeftIcon, CameraIcon, EyeIcon, EyeOffIcon, TrashIcon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { notifyProfileUpdated } from "@/lib/socket";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
      <label className="mt-2 text-sm font-medium text-ink-soft">{label}</label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          className="w-full rounded-card border border-surface-border bg-surface p-3 pr-10 text-base text-ink outline-none transition-colors focus:border-brand-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-brand-500"
        >
          {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

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

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;

    setAvatarError(null);
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError("Formato não suportado — envie JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Arquivo muito grande (máx. 2MB).");
      return;
    }

    setUploadingAvatar(true);
    try {
      const { user } = await updateAvatar(file);
      setUser(user);
      notifyProfileUpdated();
    } catch {
      setAvatarError("Não foi possível enviar a foto. Tente de novo.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setRemovingAvatar(true);
    try {
      const { user } = await removeAvatar();
      setUser(user);
      notifyProfileUpdated();
    } catch {
      setAvatarError("Não foi possível remover a foto. Tente de novo.");
    } finally {
      setRemovingAvatar(false);
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
    <main className="mx-auto max-w-2xl p-10">
      <div className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <h1 className="font-display text-2xl font-bold text-ink">Perfil</h1>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            onClick={handleBack}
            aria-label="Voltar"
            title="Voltar"
            className="flex h-10 w-10 items-center justify-center rounded-card border border-surface-border text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-500"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <section className="mb-8 rounded-card border border-surface-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 font-display text-base font-semibold text-ink">Dados da conta</h2>

        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative">
            <Avatar name={user.name} avatarUrl={user.avatarUrl} className="h-32 w-32 text-4xl" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Trocar foto"
              title="Trocar foto"
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              <CameraIcon className="h-4 w-4" />
            </button>
            {user.avatarUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={removingAvatar}
                aria-label="Remover foto"
                title="Remover foto"
                className="absolute -bottom-1 -left-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>
          <div className="text-center">
            <p className="text-sm text-ink-soft">{user.email}</p>
            {uploadingAvatar && <p className="mt-1 text-xs text-ink-soft">Enviando foto...</p>}
            {avatarError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{avatarError}</p>
            )}
          </div>
        </div>

        <form onSubmit={handleSaveName} className="flex flex-col gap-2.5">
          <label className="text-sm font-medium text-ink-soft">Nome</label>
          <input
            className="rounded-card border border-surface-border bg-surface p-3 text-base text-ink outline-none transition-colors focus:border-brand-500"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            disabled={savingName}
            className="self-start rounded-card bg-brand-500 px-5 py-2 text-base font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
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

      <section className="rounded-card border border-surface-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 font-display text-base font-semibold text-ink">Trocar senha</h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-2.5">
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
            className="mt-2 self-start rounded-card bg-brand-500 px-5 py-2 text-base font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
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

      <div className="mt-8">
        <AccountDeletionSection userId={user.id} />
      </div>
    </main>
  );
}
