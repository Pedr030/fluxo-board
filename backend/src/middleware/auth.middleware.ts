import { NextFunction, Request, Response } from "express";
import { ParamsFlatDictionary } from "express-serve-static-core";
import jwt from "jsonwebtoken";

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
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}
