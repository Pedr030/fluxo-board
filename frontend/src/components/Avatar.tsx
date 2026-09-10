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
    return <img src={avatarUrl} alt={name} className={`${className} rounded-full object-cover`} />;
  }
  return (
    <div
      className={`flex items-center justify-center rounded-full font-semibold text-white ${colorClassName} ${className}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
