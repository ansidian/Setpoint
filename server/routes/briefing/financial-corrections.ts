import { Router } from 'express';
import { financialCorrections } from '../../financial-corrections/financial-corrections.ts';
import { requestTransactionImportDrain } from '../../transaction-imports/transaction-import-runtime.ts';

const router = Router();
router.post('/financial-corrections/preview', async (req, res, next) => {
  try { res.json(await financialCorrections.preview(process.env.EA_USER_ID!, req.body?.reference, req.body?.draft)); }
  catch (error) { next(error); }
});
router.post('/financial-corrections/confirm', async (req, res, next) => {
  try {
    const result = await financialCorrections.confirm(process.env.EA_USER_ID!, req.body?.previewId, req.body?.idempotencyKey);
    requestTransactionImportDrain();
    res.json(result);
  } catch (error) { next(error); }
});
router.get('/financial-corrections/:id', async (req, res, next) => {
  try {
    const result = await financialCorrections.read(process.env.EA_USER_ID!, req.params.id);
    if (!result) return res.status(404).json({ message: 'Correction not found' });
    res.json(result);
  } catch (error) { next(error); }
});
export default router;
