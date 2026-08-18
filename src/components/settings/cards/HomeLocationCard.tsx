import { useEffect, useState } from "react";
import { Home, LoaderCircle, MapPin, Search, Trash2 } from "lucide-react";
import {
  getCalendarPlaceDetails,
  getCalendarPlaceSuggestions,
  updateSettings,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import type { CalendarPlaceSuggestion } from "../../../../shared/types/calendar";
import type { SettingsCardStateProps, SettingsConnectionRefreshProps } from "../settingsTypes";

const BUTTON_MOTION = "transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px active:translate-y-0 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function HomeLocationCard({
  settings,
  onRefreshConnections = async () => {},
}: Pick<SettingsCardStateProps, "settings"> & SettingsConnectionRefreshProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CalendarPlaceSuggestion[]>([]);
  const [sessionToken, setSessionToken] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHome, setSavedHome] = useState({
    label: settings?.home_location_label || "",
    address: settings?.home_location_address || "",
  });

  useEffect(() => {
    setSavedHome({
      label: settings?.home_location_label || "",
      address: settings?.home_location_address || "",
    });
  }, [settings?.home_location_address, settings?.home_location_label]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return undefined;
    }
    const token = sessionToken || crypto.randomUUID();
    if (!sessionToken) setSessionToken(token);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await getCalendarPlaceSuggestions(trimmed, token);
        if (!cancelled) setSuggestions(response.places || []);
      } catch (caught) {
        if (!cancelled) {
          setSuggestions([]);
          setError(errorMessage(caught, "Home search is unavailable. Check the Places API setup and try again."));
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sessionToken]);

  async function selectHome(suggestion: CalendarPlaceSuggestion) {
    setSaving(true);
    setError(null);
    try {
      const response = await getCalendarPlaceDetails(suggestion.placeId, sessionToken || undefined);
      const place = response.place;
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
        throw new Error("Google Places did not return complete coordinates for this Home.");
      }
      const label = place.displayName || suggestion.primaryText || "Home";
      const address = place.formattedAddress || place.location;
      await updateSettings({
        home_location_label: label,
        home_location_address: address,
        home_location_place_id: place.placeId,
        home_location_lat: place.lat,
        home_location_lng: place.lng,
      });
      setSavedHome({ label, address });
      setQuery("");
      setSuggestions([]);
      setSessionToken("");
      sessionStorage.setItem("ea_settings_changed", "1");
      window.dispatchEvent(new CustomEvent("ea-settings-changed"));
      await onRefreshConnections().catch(() => {});
    } catch (caught) {
      setError(errorMessage(caught, "Home could not be saved. Check Google Maps Platform and try again."));
    } finally {
      setSaving(false);
    }
  }

  async function removeHome() {
    setSaving(true);
    setError(null);
    try {
      await updateSettings({
        home_location_label: null,
        home_location_address: null,
        home_location_place_id: null,
        home_location_lat: null,
        home_location_lng: null,
      });
      setSavedHome({ label: "", address: "" });
      setConfirmingRemoval(false);
      sessionStorage.setItem("ea_settings_changed", "1");
      window.dispatchEvent(new CustomEvent("ea-settings-changed"));
      await onRefreshConnections().catch(() => {});
    } catch (caught) {
      setError(errorMessage(caught, "Home could not be removed. Try again."));
    } finally {
      setSaving(false);
    }
  }

  const hasHome = !!savedHome.address;

  return (
    <SettingsCard
      id="google-maps-home"
      title="Home"
      icon={<Home size={14} />}
      description="Private origin for driving-only Time-to-Leave estimates. Setpoint displays the address, never its stored coordinates."
    >
      <div className="flex flex-col gap-4">
        {hasHome ? (
          <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="shrink-0 text-primary" />
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {savedHome.label || "Home"}
                </div>
                <StatusPill tone="success">Saved</StatusPill>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/80">
                {savedHome.address}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setConfirmingRemoval(true)}
              className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION, "shrink-0")}
            >
              <Trash2 size={13} />
              Remove Home
            </Button>
          </div>
        ) : (
          <StatusPill tone="warning" className="self-start">Home required for Time to Leave</StatusPill>
        )}

        <div>
          <SectionLabel>{hasHome ? "Replace Home" : "Choose Home"}</SectionLabel>
          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              aria-label={hasHome ? "Replace Home" : "Choose Home"}
              value={query}
              disabled={saving}
              onChange={(event) => {
                setQuery(event.target.value);
                setError(null);
              }}
              placeholder="Search for a private Home address"
              className="pl-9"
            />
            {searching ? (
              <LoaderCircle size={14} aria-label="Searching places" className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-primary motion-reduce:animate-none" />
            ) : null}
          </div>
          <FieldHint className="mt-1">
            Places selects Home. Routes calculates traffic-aware departure time. Enable both APIs for this key.
          </FieldHint>
        </div>

        {suggestions.length ? (
          <div className="flex flex-col gap-1.5" role="listbox" aria-label="Home suggestions">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.placeId}
                type="button"
                role="option"
                aria-selected="false"
                disabled={saving}
                onClick={() => void selectHome(suggestion)}
                className={cn(
                  "min-h-11 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-50",
                  "transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px hover:border-primary/25 hover:bg-primary/[0.07] active:translate-y-0 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none",
                )}
              >
                <span className="block text-[12px] font-medium text-foreground">{suggestion.primaryText}</span>
                {suggestion.secondaryText ? (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/75">{suggestion.secondaryText}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {confirmingRemoval ? (
          <div className="rounded-xl border border-warning/20 bg-warning/[0.06] p-3">
            <p className="text-[12px] leading-relaxed text-foreground/85">
              Removing Home blocks every pending Time-to-Leave reminder until a new Home is saved.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={saving}
                onClick={() => void removeHome()}
                className={BUTTON_MOTION}
              >
                {saving ? "Removing…" : "Confirm remove Home"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={() => setConfirmingRemoval(false)}
                className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
              >
                Keep Home
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" className="text-[11px] leading-relaxed text-danger">{error}</p> : null}
        <FieldHint>
          Google Maps Platform billing and quotas apply. <a className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" href="https://mapsplatform.google.com/pricing/" target="_blank" rel="noreferrer">Review current Maps pricing</a>.
        </FieldHint>
      </div>
    </SettingsCard>
  );
}
