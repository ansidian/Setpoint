import { Router } from "express";
import db from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const userId = () => process.env.EA_USER_ID;

router.get("/", async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT * FROM ea_notes WHERE user_id = ? ORDER BY sort_order",
      args: [userId()],
    });
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching notes:", err);
    res.status(500).json({ message: "Failed to fetch notes" });
  }
});

router.post("/", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ message: "Content is required" });
  }
  try {
    await db.execute({
      sql: "UPDATE ea_notes SET sort_order = sort_order + 1 WHERE user_id = ?",
      args: [userId()],
    });
    const result = await db.execute({
      sql: "INSERT INTO ea_notes (user_id, content, sort_order) VALUES (?, ?, 0)",
      args: [userId(), content.trim()],
    });
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      user_id: userId(),
      content: content.trim(),
      sort_order: 0,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
  } catch (err) {
    console.error("Error creating note:", err);
    res.status(500).json({ message: "Failed to create note" });
  }
});

router.patch("/reorder", async (req, res) => {
  const { noteIds } = req.body;
  if (!Array.isArray(noteIds)) {
    return res.status(400).json({ message: "noteIds array is required" });
  }
  try {
    const stmts = noteIds.map((id, i) => ({
      sql: "UPDATE ea_notes SET sort_order = ? WHERE id = ? AND user_id = ?",
      args: [i, id, userId()],
    }));
    await db.batch(stmts);
    res.json({ success: true });
  } catch (err) {
    console.error("Error reordering notes:", err);
    res.status(500).json({ message: "Failed to reorder notes" });
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ message: "Content is required" });
  }
  try {
    await db.execute({
      sql: "UPDATE ea_notes SET content = ? WHERE id = ? AND user_id = ?",
      args: [content.trim(), id, userId()],
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating note:", err);
    res.status(500).json({ message: "Failed to update note" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({
      sql: "DELETE FROM ea_notes WHERE id = ? AND user_id = ?",
      args: [id, userId()],
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting note:", err);
    res.status(500).json({ message: "Failed to delete note" });
  }
});

export default router;
