import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.middleware";
import { matchesImageSignature } from "../lib/imageSignature";
import { sensitiveActionLimiter } from "../middleware/rateLimit";
import {
  changePassword,
  deleteAccount,
  deleteAvatar,
  getMe,
  updateAvatar,
  updateProfile,
} from "../controllers/me.controller";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Guarda o arquivo em memória (não em disco) — é só um buffer curto que
// repassamos pro Supabase Storage, não precisamos persistir localmente.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (!ACCEPTED_TYPES.includes(file.mimetype)) {
      return cb(new Error("Formato não suportado — envie JPEG, PNG ou WebP"));
    }
    cb(null, true);
  },
});

// multer.single() chama seu callback com um erro em vez de lançar exceção
// (Express 4 não captura erro async sozinho) — sem esse wrapper, um arquivo
// grande demais ou de tipo errado derrubaria a requisição sem resposta.
// Depois que o multer aceita o arquivo pelo Content-Type declarado, ainda
// confere os bytes de verdade (matchesImageSignature) — o Content-Type é
// só o que o cliente *alega* que é, alguém montando a requisição na mão
// podia mentir isso pra tentar subir outra coisa disfarçada de imagem.
function uploadAvatarFile(req: Request, res: Response, next: NextFunction) {
  upload.single("avatar")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Arquivo muito grande (máx. 2MB)" });
    }
    if (err) {
      return res.status(400).json({ error: err.message || "Não foi possível processar o arquivo" });
    }
    if (req.file && !matchesImageSignature(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: "O arquivo não é uma imagem válida" });
    }
    next();
  });
}

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get("/", getMe);
meRouter.patch("/", updateProfile);
meRouter.patch("/password", sensitiveActionLimiter, changePassword);
meRouter.patch("/avatar", sensitiveActionLimiter, uploadAvatarFile, updateAvatar);
meRouter.delete("/avatar", deleteAvatar);
meRouter.delete("/", sensitiveActionLimiter, deleteAccount);
