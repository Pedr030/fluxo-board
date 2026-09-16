import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { listActivity } from "../controllers/activity.controller";
import {
  createBoard,
  deleteBoard,
  getBoard,
  inviteMember,
  listBoards,
  listMembers,
  updateMember,
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
boardRouter.patch("/:id/members/:memberId", updateMember);
boardRouter.get("/:id/activity", listActivity);
boardRouter.post("/:id/lists", createList);
boardRouter.post("/:id/labels", createLabel);
boardRouter.delete("/:id", deleteBoard);
