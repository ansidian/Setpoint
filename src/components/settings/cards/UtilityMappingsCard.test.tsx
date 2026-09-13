import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UtilityMappingSettings, UtilityMappingUpdate } from '../../../../shared/types/finances';
import type { SettingsPatchRequest } from '../../../../shared/types/settings';
import type { SettingsState } from '../settingsTypes';

const boundary = vi.hoisted(() => ({
  mappings: null as UtilityMappingSettings | null,
  settings: {} as SettingsState,
  failMapping: false,
  failLinks: false,
}));

// test-architecture: allow-boundary-mock -- These authenticated HTTP endpoints are external persistence boundaries. Exercise the real card, pickers, URL editor, and calendar link consumer together.
vi.mock('@/api', () => ({
  getUtilityMappings: async () => structuredClone(boundary.mappings),
  getSettings: async () => structuredClone(boundary.settings),
  updateUtilityMapping: async (id: string, update: UtilityMappingUpdate) => {
    if (boundary.failMapping) throw new Error('Actual is unavailable.');
    const utility = boundary.mappings!.utilities.find(row => row.id === id)!;
    Object.assign(utility, structuredClone(update));
    return structuredClone(utility);
  },
  updateSettings: async (updates: SettingsPatchRequest) => {
    if (boundary.failLinks) throw new Error('Settings could not be saved. Try again.');
    Object.assign(boundary.settings, structuredClone(updates));
    return { success: true };
  },
}));

const { default: UtilityMappingsCard } = await import('./UtilityMappingsCard');
const { useUtilityPayLinks } = await import('@/hooks/useUtilityPayLinks');

const electricLink = { scheduleId: 'electric', label: 'Electricity', url: 'https://electric.example/pay' };
const rentLink = { scheduleId: 'rent', label: 'Rent', url: 'https://rent.example/pay' };

function renderCard() {
  function Harness() {
    const [settings, setSettings] = useState<SettingsState | null>(structuredClone(boundary.settings));
    const calendarLinks = useUtilityPayLinks();
    return <>
      <UtilityMappingsCard budgetId="budget" available settings={settings} setSettings={setSettings}
        metadata={{ accounts: [], categories: [], payees: boundary.mappings!.payees, schedules: boundary.mappings!.schedules }}/>
      <output aria-label="Calendar pay links">{JSON.stringify(calendarLinks)}</output>
    </>;
  }
  return render(<Harness/>);
}

async function chooseSchedule(label: string, name: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  boundary.failMapping = false;
  boundary.failLinks = false;
  boundary.settings = { actual_budget_sync_id: 'budget', utility_pay_links: [electricLink, rentLink] };
  boundary.mappings = {
    budgetId: 'budget', metadataAvailable: true,
    utilities: [{ id: 'electricity', label: 'Electricity', provider: 'Electric', budgetId: 'budget', payeeId: 'electric', scheduleIds: ['electric'], sourceSenders: ['billing@electric.example'] }],
    payees: ['electric', 'new-electric', 'rent', 'phone'].map(id => ({ id, name: { electric: 'Electric', 'new-electric': 'New Electric', rent: 'Rent', phone: 'Phone' }[id]! })),
    schedules: ['electric', 'new-electric', 'rent', 'phone'].map(id => ({ id, name: { electric: 'Electric', 'new-electric': 'New Electric', rent: 'Rent', phone: 'Phone' }[id]!, type: 'bill', conditions: [{ field: 'payee', op: 'is', value: id }] })),
  };
});
afterEach(cleanup);

// A partial schedule/link write can misdirect a calendar payment link. Browser inspection cannot reliably induce that HTTP failure or prove recovery preserves unrelated saved links.
describe('utility settings explicit saves', () => {
  it('keeps mapping and URL drafts local on blur and Cancel, then saves a URL and refreshes calendar links', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Electricity' }));
    await chooseSchedule('Electricity Actual Schedule', 'New Electric');
    fireEvent.change(screen.getByLabelText('Electricity pay link (optional)'), { target: { value: 'https://new-electric.example/pay' } });
    fireEvent.blur(screen.getByLabelText('Electricity pay link (optional)'));
    await act(async () => {});
    expect(boundary.mappings!.utilities[0]!.scheduleIds).toEqual(['electric']);
    expect(boundary.settings.utility_pay_links).toEqual([electricLink, rentLink]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Electricity' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Electricity' }));
    expect((screen.getByLabelText('Electricity pay link (optional)') as HTMLInputElement).value).toBe(electricLink.url);
    fireEvent.change(screen.getByLabelText('Electricity pay link (optional)'), { target: { value: 'https://electric.example/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Electricity saved.');
    expect(boundary.settings.utility_pay_links).toEqual([rentLink, { ...electricLink, url: 'https://electric.example/new' }]);
    await waitFor(() => expect(screen.getByLabelText('Calendar pay links').textContent).toContain('https://electric.example/new'));
  });

  it('preserves both fields on mapping failure and recovers the remaining link after a partial save', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Electricity' }));
    await chooseSchedule('Electricity Actual Schedule', 'New Electric');
    fireEvent.change(screen.getByLabelText('Electricity pay link (optional)'), { target: { value: 'https://new-electric.example/pay' } });
    boundary.failMapping = true;
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Actual is unavailable.');
    expect(boundary.mappings!.utilities[0]!.scheduleIds).toEqual(['electric']);
    expect(boundary.settings.utility_pay_links).toEqual([electricLink, rentLink]);
    boundary.failMapping = false;
    boundary.failLinks = true;
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Schedule saved; pay link wasn’t saved');
    expect(boundary.mappings!.utilities[0]!.scheduleIds).toEqual(['new-electric']);
    expect(boundary.settings.utility_pay_links).toEqual([electricLink, rentLink]);
    expect((screen.getByLabelText('Electricity pay link (optional)') as HTMLInputElement).value).toBe('https://new-electric.example/pay');
    // The first write is already saved; a retry must work even if that provider has since gone offline.
    boundary.failMapping = true;
    boundary.failLinks = false;
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Electricity saved.');
    expect(boundary.settings.utility_pay_links).toEqual([electricLink, rentLink, { scheduleId: 'new-electric', label: 'Electricity', url: 'https://new-electric.example/pay' }]);
    expect(boundary.mappings!.utilities[0]!.sourceSenders).toEqual(['billing@electric.example']);
  });

  it('adds, edits, and removes additional links explicitly while preserving utility links on failures', async () => {
    renderCard();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Add pay link' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Add pay link' }));
    await chooseSchedule('Schedule for pay link', 'Phone');
    fireEvent.change(screen.getByRole('textbox', { name: 'Bill pay link' }), { target: { value: 'https://phone.example/pay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(boundary.settings.utility_pay_links).toEqual([electricLink, rentLink]);
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add bill pay link' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add pay link' }));
    await chooseSchedule('Schedule for pay link', 'Phone');
    fireEvent.change(screen.getByRole('textbox', { name: 'Bill pay link' }), { target: { value: 'https://phone.example/pay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Pay link saved.');
    expect(boundary.settings.utility_pay_links).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Phone pay link' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Bill pay link' }), { target: { value: 'https://phone.example/new' } });
    boundary.failLinks = true;
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Couldn’t save the link/);
    expect(boundary.settings.utility_pay_links?.find(link => link.scheduleId === 'phone')?.url).toBe('https://phone.example/pay');
    boundary.failLinks = false;
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Pay link saved.');
    expect(boundary.settings.utility_pay_links?.find(link => link.scheduleId === 'phone')?.url).toBe('https://phone.example/new');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Phone pay link' }));
    boundary.failLinks = true;
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    await screen.findByText(/Couldn’t remove the link/);
    expect(boundary.settings.utility_pay_links).toHaveLength(3);
    boundary.failLinks = false;
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    await screen.findByText('Pay link removed.');
    expect(boundary.settings.utility_pay_links).toEqual([electricLink, rentLink]);
    await waitFor(() => expect(screen.getByLabelText('Calendar pay links').textContent).not.toContain('phone.example'));
  });
});
