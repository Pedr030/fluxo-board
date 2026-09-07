import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  userId?: string;
}

/**
 * Middleware de autenticação: espera um header
 * `Authorization: Bearer <token>` com um JWT válido.
 *
 * TODO: implementar a verificação de fato.
 * Dica: jwt.verify(token, process.env.JWT_SECRET!) retorna o payload
 * (você vai precisar ter colocado { userId } no payload ao assinar o
 * token em auth.controller.ts).
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
