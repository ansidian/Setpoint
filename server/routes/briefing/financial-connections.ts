import { Router } from 'express';
import { readFinancialConnections, saveFinancialConnections } from '../../financial-connections/service.ts';
import { FINANCIAL_PROVIDER_CATALOG } from '../../../shared/types/financial-parsers.ts';
import { requestTransactionImportDrain } from '../../transaction-imports/transaction-import-runtime.ts';
const router=Router();
router.get('/financial-connections',async (_req,res,next)=>{
  try{res.json({...await readFinancialConnections(process.env.EA_USER_ID!),catalog:FINANCIAL_PROVIDER_CATALOG});}catch(error){next(error);}
});
router.put('/financial-connections',async (req,res,next)=>{
  try{const result=await saveFinancialConnections(process.env.EA_USER_ID!,req.body);requestTransactionImportDrain();res.json(result);}catch(error){next(error);}
});
export default router;
