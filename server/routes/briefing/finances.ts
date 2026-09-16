import { Router } from 'express';
import { readFinanceWorkspace } from '../../finances/finance-workspace.ts';
import { readJournalRange } from '../../actual/actual.ts';
import { savePaymentOrganization } from '../../finances/payment-groups.ts';

const router = Router();
const owner = () => process.env.EA_USER_ID!;
router.put('/finances/payment-groups', async (req, res, next) => {
  try { res.json(await savePaymentOrganization(owner(), req.body)); } catch (error) { next(error); }
});
router.all(['/finances/utility-mappings', '/finances/utility-mappings/:id'], (_req, res) => {
  res.status(410).json({ message: 'Use Financial providers to update financial configuration.' });
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
