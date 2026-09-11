import crypto from "crypto";
import { Response } from "express";
import { Server } from "socket.io";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";
import { attachmentObjectKey, removeAttachment, uploadAttachment } from "../lib/supabaseStorage";

const uploaderSelect = { id: true, name: true, avatarUrl: true };

/**
 * GET /cards/:id/attachments
 * Igual comentários: carregado só quando o modal de detalhes abre, não
 * vem junto do GET /boards/:id.
 */
export async function listAttachments(req: AuthRequest, res: Response) {
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }
  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const attachments = await prisma.attachment.findMany({
    where: { cardId },
    orderBy: { createdAt: "asc" },
    include: { uploader: { select: uploaderSelect } },
  });

  return res.json({ attachments });
}

/**
 * POST /cards/:id/attachments  (multipart/form-data, campo "file")
 * O middleware de upload (ver card.routes.ts) já validou tamanho/tipo —
 * se chegou aqui, req.file existe e é uma imagem de verdade.
 *
 * Gera o id explicitamente (crypto.randomUUID(), não o cuid padrão do
 * Prisma) porque precisa dele ANTES do create() — é a chave do objeto no
 * Storage, e assim dá pra reconstruir essa mesma chave só com os dados da
 * linha do banco depois (attachmentObjectKey), sem guardar mais uma
 * coluna redundante.
 */
export async function createAttachment(req: AuthRequest, res: Response) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado" });
  }
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }
  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const id = crypto.randomUUID();
  const url = await uploadAttachment(attachmentObjectKey(cardId, id), file.buffer, file.mimetype);

  const attachment = await prisma.attachment.create({
    data: {
      id,
      cardId,
      uploaderId: req.userId,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url,
    },
    include: { uploader: { select: uploaderSelect } },
  });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("attachment:created", { attachment, cardId });

  return res.status(201).json({ attachment });
}

/**
 * DELETE /attachments/:id
 * Só quem subiu pode excluir — mesma regra dos comentários. Remove do
 * Storage antes de apagar a linha (mesma ordem do deleteAvatar em
 * me.controller.ts): se a remoção do arquivo falhar, a linha continua
 * existindo e a operação pode ser tentada de novo, em vez de ficar um
 * arquivo órfão no bucket sem nenhuma referência no banco.
 */
export async function deleteAttachment(req: AuthRequest, res: Response) {
  const attachmentId = req.params.id;

  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) {
    return res.status(404).json({ error: "Anexo não encontrado" });
  }
  if (attachment.uploaderId !== req.userId) {
    return res.status(403).json({ error: "Você só pode excluir seus próprios anexos" });
  }

  const card = await prisma.card.findUnique({ where: { id: attachment.cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }
  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }

  await removeAttachment(attachmentObjectKey(attachment.cardId, attachment.id));
  await prisma.attachment.delete({ where: { id: attachmentId } });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("attachment:deleted", { attachmentId, cardId: attachment.cardId });

  return res.status(204).send();
}
