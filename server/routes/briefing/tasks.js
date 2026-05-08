import { Router } from "express";
import * as tasksService from "../../briefing/tasks-service.js";
import { applyDeadlineCurrentStatus } from "../../dashboard/current-service.js";

const router = Router();
const EA_USER_ID = process.env.EA_USER_ID;

router.post("/complete-task/:taskId", async (req, res) => {
  try {
    await tasksService.completeTask(EA_USER_ID, req.params.taskId);
    await applyDeadlineCurrentStatus(EA_USER_ID, req.params.taskId, "complete", {
      source: "todoist",
    }).catch((err) => {
      console.error("[Briefing] Failed to update current Todoist deadline cache:", err.message);
    });
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error completing task:", err);
    res.status(status).json({ message: err.message || "Failed to complete task" });
  }
});

router.delete("/tombstone/:todoistId", async (req, res) => {
  try {
    await tasksService.dismissTombstone(EA_USER_ID, req.params.todoistId);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error dismissing tombstone:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.patch("/task-status/:taskId", async (req, res) => {
  const { status } = req.body;
  try {
    await tasksService.updateCTMStatus(EA_USER_ID, req.params.taskId, status);
    await applyDeadlineCurrentStatus(EA_USER_ID, req.params.taskId, status, {
      source: "ctm",
    }).catch((err) => {
      console.error("[Briefing] Failed to update current CTM deadline cache:", err.message);
    });
    res.json({ ok: true, status });
  } catch (err) {
    const httpStatus = err.status || 500;
    if (httpStatus >= 500) console.error("Error updating task status:", err);
    res.status(httpStatus).json({ message: err.message || "Failed to update task status" });
  }
});

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

router.post("/todoist/tasks", async (req, res) => {
  try {
    res.json(await tasksService.createTask(EA_USER_ID, req.body));
  } catch (err) {
    console.error("Error creating Todoist task:", err.message);
    res.status(err.status || 400).json({ message: err.message });
  }
});

router.post("/todoist/tasks/:id", async (req, res) => {
  try {
    res.json(await tasksService.updateTask(EA_USER_ID, req.params.id, req.body));
  } catch (err) {
    console.error("Error updating Todoist task:", err.message);
    res.status(err.status || 400).json({ message: err.message });
  }
});

router.delete("/todoist/tasks/:id", async (req, res) => {
  try {
    await tasksService.deleteTask(EA_USER_ID, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting Todoist task:", err.message);
    res.status(err.status || 400).json({ message: err.message });
  }
});

export default router;
