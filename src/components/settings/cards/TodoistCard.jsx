import { useEffect, useState } from "react";
import { SiTodoist } from "@icons-pack/react-simple-icons";
import { updateSettings } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import { SETTINGS_PRIMARY_BUTTON_CLASS } from "@/components/settings/settings-core";

export default function TodoistCard({ settings }) {
  const [todoistToken, setTodoistToken] = useState("");
  const [todoistConfigured, setTodoistConfigured] = useState(false);
  const [todoistDirty, setTodoistDirty] = useState(false);
  const [todoistSavingSecret, setTodoistSavingSecret] = useState(false);

  useEffect(() => {
    if (settings?.todoist_configured) {
      setTodoistConfigured(true);
    }
  }, [settings?.todoist_configured]);

  async function handleSaveTodoistSecret() {
    setTodoistSavingSecret(true);
    try {
      await updateSettings({ todoist_api_token: todoistToken });
      sessionStorage.setItem("ea_settings_changed", "1");
      setTodoistConfigured(true);
      setTodoistDirty(false);
      setTodoistToken("");
    } finally {
      setTodoistSavingSecret(false);
    }
  }

  return (
    <SettingsCard
      title="Todoist"
      icon={<SiTodoist size={14} title="" aria-hidden="true" />}
      description="Optional task sync used when email automation creates Todoist follow-ups."
    >
      <div className="flex flex-col gap-4">
        <div>
          <SectionLabel>API Token</SectionLabel>
          <Input
            type="password"
            placeholder={
              todoistConfigured && !todoistDirty
                ? "••••••••  (saved)"
                : "Todoist API token"
            }
            value={todoistToken}
            onChange={(event) => {
              setTodoistToken(event.target.value);
              setTodoistDirty(true);
            }}
          />
          <FieldHint className="mt-1">
            Find your token at Settings &gt; Integrations &gt; Developer in Todoist.
          </FieldHint>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleSaveTodoistSecret}
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={!todoistDirty || todoistSavingSecret}
            size="sm"
          >
            {todoistSavingSecret ? "Saving…" : "Save"}
          </Button>
          {todoistConfigured && !todoistDirty ? (
            <>
              <StatusPill tone="success">Connected</StatusPill>
              <button
                type="button"
                onClick={() => {
                  setTodoistToken("");
                  setTodoistDirty(true);
                  setTodoistConfigured(false);
                }}
                className="text-[11px] font-medium text-muted-foreground/75 transition-colors hover:text-danger"
              >
                Disconnect
              </button>
            </>
          ) : null}
        </div>
      </div>
    </SettingsCard>
  );
}
