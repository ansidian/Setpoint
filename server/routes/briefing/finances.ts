import { Router } from 'express';
import { readFinanceWorkspace } from '../../finances/finance-workspace.ts';
import { readJournalRange } from '../../actual/actual.ts';
import { readUtilityMappings, updateUtilityMapping } from '../../finances/utility-mappings.ts';

const router = Router();
const owner = () => process.env.EA_USER_ID!;
router.get('/finances/utility-mappings', async (_req, res, next) => {
  try { res.json(await readUtilityMappings(owner())); } catch (error) { next(error); }
});
router.put('/finances/utility-mappings/:id', async (req, res, next) => {
  try { res.json(await updateUtilityMapping(owner(), String(req.params.id), req.body)); } catch (error) { next(error); }
});
router.get('/finances', async (_req, res, next) => {
  try { res.json(await readFinanceWorkspace(owner())); } catch (error) { next(error); }
});
router.get('/finances/journal', async (req, res, next) => {
  try {
    res.json(await readJournalRange(owner(), { start: String(req.query.start || ''), end: String(req.query.end || ''),
      transactionId: typeof req.query.transactionId === 'string' ? req.query.transactionId : undefined }));
  } catch (error) { next(error); }
});
export default router;
