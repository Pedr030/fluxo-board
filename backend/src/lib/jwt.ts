import jwt from "jsonwebtoken";

// 7 dias: validade de cada token e, por extensão (ver requireAuth, que
// reemite antes de expirar), o tempo máximo que alguém pode passar sem usar
// o app antes de precisar logar de novo.
export const TOKEN_TTL = "7d";
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: TOKEN_TTL });
}
