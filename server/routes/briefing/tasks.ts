import { Router } from "express";
import * as tasksService from "../../tasks/tasks-service.ts";

const router = Router();
const ownerUserId = (): string => process.env.EA_USER_ID!;

function errorDetails(error: unknown): { message: string; status: number } {
  if (error instanceof Error) {
    const status = "status" in error && typeof error.status === "number" ? error.status : 400;
    return { message: error.message, status };
  }
  return { message: String(error), status: 400 };
}

router.get("/todoist/projects", async (_req, res) => {
  try {
    res.json(await tasksService.listProjects(ownerUserId()));
  } catch (err) {
    const { message, status } = errorDetails(err);
    console.error("Error fetching Todoist projects:", message);
    res.status(status).json({ message });
  }
});

router.get("/todoist/labels", async (_req, res) => {
  try {
    res.json(await tasksService.listLabels(ownerUserId()));
  } catch (err) {
    const { message, status } = errorDetails(err);
    console.error("Error fetching Todoist labels:", message);
    res.status(status).json({ message });
  }
});

export default router;
