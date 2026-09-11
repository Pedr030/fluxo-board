import { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { matchesImageSignature } from "../lib/imageSignature";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Fábrica de middleware de upload de imagem — usada tanto pro avatar
 * (me.routes.ts) quanto pros anexos de card (card.routes.ts), cada um com
 * seu próprio nome de campo e limite de tamanho.
 *
 * multer.single() chama o callback com um erro em vez de lançar exceção
 * (Express 4 não captura erro async sozinho) — sem esse wrapper, um
 * arquivo grande demais ou de tipo errado derrubaria a requisição sem
 * resposta. Guarda o arquivo em memória (não em disco): é só um buffer
 * curto que repassamos pro Supabase Storage, não precisa persistir local.
 *
 * Depois que o multer aceita o arquivo pelo Content-Type declarado, ainda
 * confere os bytes de verdade (matchesImageSignature) — o Content-Type é
 * só o que o cliente *alega* que é, alguém montando a requisição na mão
 * podia mentir isso pra tentar subir outra coisa disfarçada de imagem.
 */
export function createImageUploadMiddleware(fieldName: string, maxSizeBytes: number): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeBytes },
    fileFilter: (_req, file, cb) => {
      if (!ACCEPTED_TYPES.includes(file.mimetype)) {
        return cb(new Error("Formato não suportado — envie JPEG, PNG ou WebP"));
      }
      cb(null, true);
    },
  });

  return function handleImageUpload(req: Request, res: Response, next: NextFunction) {
    upload.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        const mb = Math.round(maxSizeBytes / (1024 * 1024));
        return res.status(400).json({ error: `Arquivo muito grande (máx. ${mb}MB)` });
      }
      if (err) {
        return res.status(400).json({ error: err.message || "Não foi possível processar o arquivo" });
      }
      if (req.file && !matchesImageSignature(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "O arquivo não é uma imagem válida" });
      }
      next();
    });
  };
}
