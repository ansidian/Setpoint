import { useEffect, useState } from "react";
import { disconnectTodoistConnection, saveTodoistPersonalToken } from "@/api";
import {
  beginTodoistOAuth,
  discardTodoistOAuthPending,
  getTodoistConnectionStatus,
  importTodoistOAuthEnvironment,
  stageTodoistOAuthApplication,
} from "@/lib/todoistSetupApi";
import type { SettingsCardStateProps, SettingsConnectionRefreshProps } from "../settingsTypes";
import type { TodoistConnectionStatus } from "../../../../shared/types/tasks";
import { isPasswordStepUpRequired, useSensitiveActionStepUp } from "../sensitiveActionStepUpModel";

/** Owns Todoist credential drafts, setup actions, and password-step-up retries. */
export function useTodoistSetup({
  settings,
  onRefreshConnections = async () => {},
}: Pick<SettingsCardStateProps, "settings"> & SettingsConnectionRefreshProps) {
  const needsReauth = !!settings?.todoist_needs_reauth;
  const [todoistToken, setTodoistToken] = useState("");
  const [todoistConfigured, setTodoistConfigured] = useState(false);
  const [todoistDirty, setTodoistDirty] = useState(false);
  const [todoistSavingSecret, setTodoistSavingSecret] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [todoistMessage, setTodoistMessage] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<TodoistConnectionStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthDiscarding, setOauthDiscarding] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const stepUp = useSensitiveActionStepUp();
  const credentialActionLocked = Boolean(stepUp.pendingLabel);

  useEffect(() => {
    if (settings?.todoist_configured) {
      setTodoistConfigured(true);
    }
  }, [settings?.todoist_configured]);

  useEffect(() => {
    let active = true;
    getTodoistConnectionStatus()
      .then((status) => {
        if (active) setOauthStatus(status);
      })
      .catch(() => {
        if (active) setOauthMessage("Advanced Todoist status is unavailable.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveTodoistSecret() {
    const candidate = todoistToken;
    await stepUp.run(async () => {
      setTodoistSavingSecret(true);
      setTodoistMessage(null);
      try {
        await saveTodoistPersonalToken(candidate);
        sessionStorage.setItem("ea_settings_changed", "1");
        window.dispatchEvent(new CustomEvent("ea-settings-changed"));
        setTodoistConfigured(true);
        setTodoistDirty(false);
        setTodoistToken("");
        await onRefreshConnections().catch(() => {});
        try {
          setOauthStatus(await getTodoistConnectionStatus());
        } catch {
          // The personal-token mutation succeeded; advanced status can recover on the next load.
        }
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setTodoistMessage("Todoist personal token could not be verified. The working connection was not changed.");
      } finally {
        setTodoistSavingSecret(false);
      }
    }, "saving the Todoist personal token");
  }

  async function handleDisconnectTodoist() {
    if (!confirmingDisconnect || credentialActionLocked || disconnecting) return;
    await stepUp.run(async () => {
      setDisconnecting(true);
      setTodoistMessage(null);
      try {
        await disconnectTodoistConnection();
        sessionStorage.setItem("ea_settings_changed", "1");
        window.dispatchEvent(new CustomEvent("ea-settings-changed"));
        setTodoistConfigured(false);
        setTodoistDirty(false);
        setTodoistToken("");
        setConfirmingDisconnect(false);
        setOauthStatus((current) => current ? {
          ...current,
          mode: "disconnected",
          configured: false,
          oauthRefreshable: false,
          needsReauth: false,
          deliveryMode: "periodic",
        } : current);
        await onRefreshConnections().catch(() => {});
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setTodoistMessage("Todoist could not be disconnected.");
      } finally {
        setDisconnecting(false);
      }
    }, "disconnecting Todoist");
  }

  async function handleSaveOAuthApplication() {
    const candidate = { clientId, clientSecret };
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthMessage(null);
      try {
        await stageTodoistOAuthApplication(candidate);
        setClientId("");
        setClientSecret("");
        try {
          setOauthStatus(await getTodoistConnectionStatus());
        } catch {
          setOauthStatus((current) => current ? {
            ...current,
            application: { ...current.application, pendingConfigured: true },
          } : current);
        }
        setOauthMessage("Application credentials saved as a pending candidate. Connect to validate them.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("Application credentials could not be saved.");
      } finally {
        setOauthBusy(false);
      }
    }, "saving the Todoist OAuth application");
  }

  async function handleImportEnvironment() {
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthMessage(null);
      try {
        await importTodoistOAuthEnvironment();
        setOauthStatus(await getTodoistConnectionStatus());
        setOauthMessage("Copied into encrypted Setpoint storage. The Render variables still remain. Back up EA_ENCRYPTION_KEY, remove both Todoist OAuth variables in Render, redeploy, then verify Todoist before considering the migration complete.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("Host-managed Todoist credentials could not be copied.");
      } finally {
        setOauthBusy(false);
      }
    }, "copying the Todoist OAuth credentials into Setpoint");
  }

  async function handleDiscardOAuthApplication() {
    const candidateVersions = oauthStatus?.application.candidateVersions;
    if (!candidateVersions) return;
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthDiscarding(true);
      setOauthMessage(null);
      try {
        await discardTodoistOAuthPending(candidateVersions);
        setOauthStatus(await getTodoistConnectionStatus());
        setOauthMessage("Pending application discarded. The active Todoist connection is unchanged.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("The pending Todoist application could not be discarded. The active connection is unchanged.");
        try {
          setOauthStatus(await getTodoistConnectionStatus());
        } catch {
          // Preserve the last redacted status when the refresh is also unavailable.
        }
      } finally {
        setOauthDiscarding(false);
        setOauthBusy(false);
      }
    }, "discarding the pending Todoist application");
  }

  async function handleBeginOAuth() {
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthMessage(null);
      try {
        const { url } = await beginTodoistOAuth();
        window.location.assign(url);
      } catch (caught) {
        setOauthBusy(false);
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("Todoist authorization could not be started.");
      }
    }, "starting Todoist authorization");
  }


  function editToken(value: string) {
    setTodoistToken(value);
    setTodoistDirty(true);
    setTodoistMessage(null);
  }

  function reconnect() {
    setTodoistToken("");
    setTodoistDirty(true);
  }

  function requestDisconnect() {
    if (!credentialActionLocked) setConfirmingDisconnect(true);
  }

  function cancelDisconnect() {
    if (!disconnecting && !credentialActionLocked) setConfirmingDisconnect(false);
  }

  return {
    needsReauth, todoistToken, todoistConfigured, todoistDirty, todoistSavingSecret,
    confirmingDisconnect, disconnecting, todoistMessage, oauthStatus,
    clientId, setClientId, clientSecret, setClientSecret, oauthBusy, oauthDiscarding,
    oauthMessage, stepUp, credentialActionLocked, editToken, reconnect,
    requestDisconnect, cancelDisconnect, handleSaveTodoistSecret,
    handleDisconnectTodoist, handleSaveOAuthApplication, handleImportEnvironment,
    handleDiscardOAuthApplication, handleBeginOAuth,
  };
}
