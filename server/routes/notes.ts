import { Router } from "express";
import db from "../db/connection.ts";
import { requireCookieSession } from "../middleware/auth.ts";
import type {
  ArchiveNoteRequest,
  CreateNoteRequest,
  Note,
  NoteId,
  NoteMutationResponse,
  ReorderNotesRequest,
  UpdateNoteRequest,
} from "../../shared/types/notes.ts";

type ErrorResponse = { message: string };

const router = Router();
router.use(requireCookieSession);

const userId = (): string => process.env.EA_USER_ID!;

router.get<Record<string, never>, Note[] | ErrorResponse>("/", async (_req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT * FROM ea_notes WHERE user_id = ? ORDER BY sort_order",
      args: [userId()],
    });
    res.json(result.rows as unknown as Note[]);
  } catch (err) {
    console.error("Error fetching notes:", err);
    res.status(500).json({ message: "Failed to fetch notes" });
  }
});

router.post<Record<string, never>, Note | ErrorResponse, CreateNoteRequest>("/", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ message: "Content is required" });
  }
  try {
    // Shift-then-insert must be atomic: a crash between the two statements would
    // permanently bump every note's sort_order with no row left at slot 0.
    // libsql batch is transactional, so the freed slot is always filled.
    const [, insert] = await db.batch([
      {
        sql: "UPDATE ea_notes SET sort_order = sort_order + 1 WHERE user_id = ?",
        args: [userId()],
      },
      {
        sql: "INSERT INTO ea_notes (user_id, content, sort_order) VALUES (?, ?, 0)",
        args: [userId(), content.trim()],
      },
    ]);
    res.status(201).json({
      id: Number(insert!.lastInsertRowid),
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

router.patch<Record<string, never>, NoteMutationResponse | ErrorResponse, ReorderNotesRequest>("/reorder", async (req, res) => {
  const { noteIds } = req.body;
  if (!Array.isArray(noteIds)) {
    return res.status(400).json({ message: "noteIds array is required" });
  }
  try {
    const stmts = noteIds.map((id: NoteId, i: number) => ({
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

router.patch<{ id: string }, NoteMutationResponse | ErrorResponse, ArchiveNoteRequest>("/:id/archive", async (req, res) => {
  const { id } = req.params;
  const archived = !!req.body?.archived;
  try {
    await db.execute({
      sql: archived
        ? "UPDATE ea_notes SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?"
        : "UPDATE ea_notes SET archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      args: [id, userId()],
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error archiving note:", err);
    res.status(500).json({ message: "Failed to archive note" });
  }
});

router.patch<{ id: string }, NoteMutationResponse | ErrorResponse, UpdateNoteRequest>("/:id", async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ message: "Content is required" });
  }
  try {
    await db.execute({
      sql: "UPDATE ea_notes SET content = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      args: [content.trim(), id, userId()],
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating note:", err);
    res.status(500).json({ message: "Failed to update note" });
  }
});

router.delete<{ id: string }, NoteMutationResponse | ErrorResponse>("/:id", async (req, res) => {
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
