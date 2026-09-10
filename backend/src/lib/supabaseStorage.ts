const AVATAR_BUCKET = "avatars";

/**
 * Sobe o avatar pro bucket `avatars` do Supabase Storage via REST direto
 * (fetch nativo do Node 20) — não precisou instalar o @supabase/supabase-js
 * inteiro só pra um upload. Caminho fixo por usuário (sem extensão; o tipo
 * real vai no Content-Type) com upsert: trocar de foto sobrescreve a
 * anterior, nunca sobra arquivo órfão no bucket.
 *
 * A URL pública de um objeto no Storage nunca muda mesmo depois de
 * sobrescrito — por isso o `?v=timestamp` no final, só pra invalidar cache
 * do navegador quando a pessoa troca de foto.
 */
export async function uploadAvatar(userId: string, buffer: Buffer, mimeType: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${AVATAR_BUCKET}/${userId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": mimeType,
      "x-upsert": "true",
    },
    body: buffer,
  });

  if (!res.ok) {
    throw new Error(`Falha ao enviar avatar pro Supabase Storage: ${res.status} ${await res.text()}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${AVATAR_BUCKET}/${userId}?v=${Date.now()}`;
}

/**
 * Remove o avatar do usuário do bucket. Idempotente: se o arquivo já não
 * existir (usuário nunca subiu foto, ou já removeu antes), o Storage
 * devolve 404 — tratado como sucesso, o objetivo ("não ter avatar
 * nenhum lá") já está atingido de qualquer forma.
 */
export async function removeAvatar(userId: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${AVATAR_BUCKET}/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });

  if (res.ok) return;

  // Achado testando: o Storage devolve HTTP 400 (não 404) quando o objeto
  // não existe, com o "404" de verdade só dentro do corpo — checar só
  // res.status não bastava, e isso virava uma exceção não tratada
  // (Express 4 não captura erro de handler async sozinho, e o Node derruba
  // o processo inteiro num unhandledRejection). Por isso checa o corpo.
  const body = await res.text();
  if (body.includes("not_found") || body.includes("NoSuchKey")) return;

  throw new Error(`Falha ao remover avatar do Supabase Storage: ${res.status} ${body}`);
}
