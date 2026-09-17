import { NextFunction, Request, Response } from "express";
import { ParamsFlatDictionary } from "express-serve-static-core";
import jwt from "jsonwebtoken";
import { TOKEN_TTL_MS, signToken } from "../lib/jwt";

// Express 5 tipa req.params como `string | string[]` por padrão (rotas com
// wildcard/segmento repetido podem produzir array) — nenhuma rota daqui usa
// isso, são todas `:id`/`:memberId` simples, então fixamos o parâmetro de
// tipo em `ParamsFlatDictionary` (sempre string) pra não precisar de um
// type assertion em cada controller que lê req.params.
export interface AuthRequest extends Request<ParamsFlatDictionary> {
  userId?: string;
}

/**
 * Middleware de autenticação: espera um header
 * `Authorization: Bearer <token>` com um JWT válido.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não informado" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; exp: number };
    req.userId = payload.userId;

    // Sessão deslizante: se o token já passou da metade da validade,
    // reemite um novo (mesmo prazo) no header de resposta. Assim, quem usa
    // o app com alguma regularidade nunca é deslogado — só expira de fato
    // quem passar TOKEN_TTL inteiro (7 dias) sem fazer nenhuma requisição
    // autenticada. exposedHeaders no CORS (app.ts) é o que permite o
    // frontend, em outra origem, enxergar esse header na resposta.
    const remainingMs = payload.exp * 1000 - Date.now();
    if (remainingMs < TOKEN_TTL_MS / 2) {
      res.setHeader("X-Refreshed-Token", signToken(payload.userId));
    }

    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}
