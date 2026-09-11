import Image from "next/image";

/**
 * Avatar de um usuário: foto de verdade quando existe, senão a inicial do
 * nome numa bolinha colorida (mesmo fallback que já era usado antes de
 * existir upload de foto). Reusado na navegação (lista de boards) e na
 * presença ao vivo dentro de um board.
 */
export function Avatar({
  name,
  avatarUrl,
  className = "h-8 w-8",
  colorClassName = "bg-brand-500",
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  colorClassName?: string;
}) {
  if (avatarUrl) {
    // `fill` em vez de width/height fixos porque o tamanho vem de fora
    // via `className` (h-7 a h-32 dependendo de onde o Avatar é usado) —
    // precisa do wrapper com posição relativa pra isso funcionar.
    return (
      <div className={`relative overflow-hidden rounded-full ${className}`}>
        <Image src={avatarUrl} alt={name} fill sizes="128px" className="object-cover" />
      </div>
    );
  }
  return (
    <div
      className={`flex items-center justify-center rounded-full font-semibold text-white ${colorClassName} ${className}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
