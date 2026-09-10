/**
 * Confere os primeiros bytes do arquivo (assinatura/"magic number") contra
 * o Content-Type que o cliente alegou. O multer só valida o mimetype que
 * veio no cabeçalho multipart — um cliente malicioso pode montar essa
 * requisição manualmente e mentir o Content-Type pra tentar subir outra
 * coisa (ex: um HTML com script) disfarçada de imagem. Isso fecha essa
 * brecha sem precisar de nenhuma lib de detecção de arquivo.
 */
export function matchesImageSignature(buffer: Buffer, mimetype: string): boolean {
  if (buffer.length < 12) return false;

  switch (mimetype) {
    case "image/jpeg":
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/png":
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case "image/webp":
      return (
        buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}
