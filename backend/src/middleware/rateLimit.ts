import { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";

// Mensagem no mesmo formato que o resto da API já usa ({ error: string }),
// pra não obrigar o frontend a tratar um formato diferente só pra 429.
function limiterMessage(error: string) {
  return { error };
}

// A suíte de testes dispara dezenas de POST /auth/register e /auth/login
// de propósito (isolamento entre usuários, etc.) — sem essa escapatória,
// os próprios testes tropeçariam no limite e quebrariam. Só desativa em
// NODE_ENV=test (setado pelo Jest sozinho); em dev/produção o limite vale
// normalmente.
function skipInTests(limiter: RequestHandler): RequestHandler {
  if (process.env.NODE_ENV === "test") {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return limiter;
}

/**
 * Registro/login: alvo clássico de força bruta e spam de conta. IP-based
 * (padrão do express-rate-limit) — exige app.set("trust proxy", ...) certo
 * em app.ts, senão em produção (atrás do proxy do Northflank) todo mundo
 * cairia sob o mesmo IP e um usuário derrubaria o limite dos outros.
 */
export const authLimiter = skipInTests(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: limiterMessage("Muitas tentativas. Aguarde alguns minutos e tente de novo."),
  })
);

/**
 * Trocar senha / trocar avatar: já exige estar autenticado, mas ainda vale
 * limitar — trocar senha repetidamente é o jeito de tentar adivinhar a
 * senha atual por força bruta, e upload de avatar sem limite é vetor de
 * abuso de armazenamento/banda.
 */
export const sensitiveActionLimiter = skipInTests(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: limiterMessage("Muitas tentativas. Aguarde alguns minutos e tente de novo."),
  })
);

/**
 * Rede de segurança geral pra API inteira — não é específico de nenhum
 * endpoint, é só um teto contra abuso/scraping que eu não previ caso a
 * caso. Bem mais permissivo que os de cima de propósito.
 */
export const globalLimiter = skipInTests(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: limiterMessage("Muitas requisições. Aguarde um pouco e tente de novo."),
  })
);
