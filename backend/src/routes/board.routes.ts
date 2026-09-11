import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import {
  createBoard,
  deleteBoard,
  getBoard,
  inviteMember,
  listBoards,
  listMembers,
} from "../controllers/board.controller";
import { createLabel } from "../controllers/label.controller";
import { createList } from "../controllers/list.controller";

export const boardRouter = Router();

boardRouter.use(requireAuth);

boardRouter.get("/", listBoards);
boardRouter.post("/", createBoard);
boardRouter.get("/:id", getBoard);
boardRouter.post("/:id/invite", inviteMember);
boardRouter.get("/:id/members", listMembers);
boardRouter.post("/:id/lists", createList);
boardRouter.post("/:id/labels", createLabel);
boardRouter.delete("/:id", deleteBoard);
