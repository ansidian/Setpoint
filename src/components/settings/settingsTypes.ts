import type { Dispatch, SetStateAction } from "react";
import type { AccountSummary } from "../../../shared/types/accounts";
import type { SettingsPatchRequest, SettingsResponse } from "../../../shared/types/settings";

export type SettingsState = Partial<SettingsResponse>;
export type SettingsStateSetter = Dispatch<SetStateAction<SettingsState | null>>;
export type SettingsPatch = (updates: Partial<SettingsPatchRequest>) => void;

export interface SettingsCardStateProps {
  settings: SettingsState | null;
  setSettings: SettingsStateSetter;
  patch: SettingsPatch;
}

export interface SettingsAccountsProps {
  accounts: AccountSummary[];
  setAccounts: Dispatch<SetStateAction<AccountSummary[]>>;
}
