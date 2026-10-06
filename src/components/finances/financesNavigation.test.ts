import { expect, it } from 'vitest';
import { financeDestination, financesHref, type FinanceDestination } from './financesNavigation';
import { resolveShellTabHotkey, resolveNotesNavigationChord } from '../dashboard/dashboardShellModel';
it('round-trips exact Payments row, occurrence and transaction targets and rejects invalid dates',()=>{
  const targets:FinanceDestination[]=[{view:'payments',month:'2026-07',rowId:'schedule:water:july'},{view:'schedule',scheduleId:'schedule',date:'2026-07-14'},{view:'journal',date:'2026-08-03',transactionId:'cross-date'}];
  for(const target of targets)expect(financeDestination(new URL(financesHref(target),'https://setpoint.test').search)).toEqual(target);
  expect(financeDestination('?view=journal&date=2026-99-99')).toMatchObject({date:undefined});
  expect(financeDestination('?month=2026-13')).toMatchObject({month:undefined});
  expect(resolveShellTabHotkey({key:'6',activeTab:'calendar'})).toBe('finances');
  expect(resolveShellTabHotkey({key:'6',anyBlockingOverlayOpen:true})).toBeNull();
  expect(resolveNotesNavigationChord({key:'6',leaderActive:true,activeTab:'notes'})).toEqual({action:'navigate',tab:'finances'});
});
