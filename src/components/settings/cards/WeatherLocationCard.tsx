import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { geocodeLocation } from "@/api";
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
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import { isDemoMode } from "@/demo/config";
import { cn } from "@/lib/utils";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { GeocodeResult } from "../../../../shared/types/settings";

interface WeatherFormState {
  location: string;
  lat: string;
  lng: string;
  geocoding: boolean;
  results: GeocodeResult[] | null;
}

export default function WeatherLocationCard({ settings, patch }: Pick<SettingsCardStateProps, "settings" | "patch">) {
  const demoMode = isDemoMode();
  const [weatherForm, setWeatherForm] = useState<WeatherFormState>({
    location: "",
    lat: "",
    lng: "",
    geocoding: false,
    results: null,
  });

  useEffect(() => {
    if (!settings?.weather_location) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the weather form from saved settings on load/change
    setWeatherForm({
      location: settings.weather_location || "",
      lat: settings.weather_lat?.toString() || "",
      lng: settings.weather_lng?.toString() || "",
      geocoding: false,
      results: null,
    });
  }, [settings?.weather_location, settings?.weather_lat, settings?.weather_lng]);

  async function handleGeocode() {
    if (!weatherForm.location) return;
    setWeatherForm((current) => ({ ...current, geocoding: true, results: null }));
    try {
      const results = await geocodeLocation(weatherForm.location);
      if (results.length === 1) {
        selectLocation(results[0]!);
      } else {
        setWeatherForm((current) => ({ ...current, geocoding: false, results }));
      }
    } catch {
      setWeatherForm((current) => ({ ...current, geocoding: false }));
    }
  }

  function selectLocation(location: GeocodeResult) {
    setWeatherForm({
      location: location.name,
      lat: location.lat.toString(),
      lng: location.lng.toString(),
      geocoding: false,
      results: null,
    });
    patch({ weather_location: location.name, weather_lat: location.lat, weather_lng: location.lng });
  }

  return (
    <SettingsCard
      title="Weather Location"
      icon={<MapPin size={14} />}
      description="Set the location used for dashboard weather snapshots and daily context."
    >
      <div className="flex flex-col gap-4">
        <div>
          <SectionLabel>City name</SectionLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              placeholder="El Monte, CA"
              value={weatherForm.location}
              onChange={(event) => setWeatherForm((current) => ({ ...current, location: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleGeocode();
              }}
              className="flex-1"
            />
            <Button
              variant="secondary"
              className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, "whitespace-nowrap")}
              onClick={handleGeocode}
              disabled={demoMode || weatherForm.geocoding || !weatherForm.location}
            >
              {weatherForm.geocoding ? "Looking up…" : "Look up"}
            </Button>
          </div>
          {demoMode ? (
            <FieldHint className="mt-1">Location lookup is not available in demo.</FieldHint>
          ) : null}
        </div>
        {weatherForm.results ? (
          <div className="flex flex-col gap-2">
            {weatherForm.results.map((result, index) => (
              <button
                key={index}
                type="button"
                onClick={() => selectLocation(result)}
                className={cn(SURFACE_ROW_CLASS, "cursor-pointer px-3 py-3 text-left")}
              >
                <div className="text-[13px] font-medium text-foreground/90">{result.name}</div>
                <div className="mt-1 text-[11px] text-muted-foreground/75">
                  {result.lat.toFixed(4)}, {result.lng.toFixed(4)}
                </div>
              </button>
            ))}
          </div>
        ) : null}
        {weatherForm.lat && weatherForm.lng ? (
          <StatusPill tone="accent" className="self-start">
            {weatherForm.lat}, {weatherForm.lng}
          </StatusPill>
        ) : null}
      </div>
    </SettingsCard>
  );
}
