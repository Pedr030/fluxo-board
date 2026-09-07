import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import {
  createBoard,
  getBoard,
  inviteMember,
  listBoards,
  listMembers,
} from "../controllers/board.controller";
import { createList } from "../controllers/list.controller";

export const boardRouter = Router();

boardRouter.use(requireAuth);

boardRouter.get("/", listBoards);
boardRouter.post("/", createBoard);
boardRouter.get("/:id", getBoard);
boardRouter.post("/:id/invite", inviteMember);
boardRouter.get("/:id/members", listMembers);
boardRouter.post("/:id/lists", createList);

// TODO: PATCH /lists/:id (renomear/reordenar lista) e editar/excluir card
// entram na etapa de polish do roadmap.
