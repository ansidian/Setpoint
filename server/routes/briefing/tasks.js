import { Router } from "express";
import * as tasksService from "../../tasks/tasks-service.js";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID;

router.get("/todoist/projects", async (_req, res) => {
  try {
    res.json(await tasksService.listProjects(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching Todoist projects:", err.message);
    res.status(err.status || 400).json({ message: err.message });
  }
});

router.get("/todoist/labels", async (_req, res) => {
  try {
    res.json(await tasksService.listLabels(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching Todoist labels:", err.message);
    res.status(err.status || 400).json({ message: err.message });
  }
});

export default router;
