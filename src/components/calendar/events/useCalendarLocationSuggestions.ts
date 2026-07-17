import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCalendarPlaceDetails, getCalendarPlaceSuggestions } from "@/api";
import type { CalendarPlaceSuggestion } from "../../../../shared/types/calendar";

export interface CalendarLocationSuggestionsOptions {
  enabled: boolean;
  query?: string | null;
  onSelectLocation?: (location: string) => void;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function useCalendarLocationSuggestions({
  enabled,
  query,
  onSelectLocation,
}: CalendarLocationSuggestionsOptions) {
  const [locationSuggestions, setLocationSuggestions] = useState<CalendarPlaceSuggestion[]>([]);
  const [locationSuggestionsLoading, setLocationSuggestionsLoading] = useState(false);
  const [locationSuggestionsError, setLocationSuggestionsError] = useState<string | null>(null);
  const [activeLocationSuggestion, setActiveLocationSuggestion] = useState(0);
  const [placesSessionToken, setPlacesSessionToken] = useState("");
  const locationSuggestionsRef = useRef<CalendarPlaceSuggestion[]>([]);
  const activeLocationSuggestionRef = useRef(0);

  useLayoutEffect(() => {
    locationSuggestionsRef.current = locationSuggestions;
  }, [locationSuggestions]);

  useLayoutEffect(() => {
    activeLocationSuggestionRef.current = activeLocationSuggestion;
  }, [activeLocationSuggestion]);

  useEffect(() => {
    if (!enabled) return undefined;
    const trimmedQuery = String(query || "").trim();
    if (trimmedQuery.length < 2) {
      setLocationSuggestions([]);
      setLocationSuggestionsLoading(false);
      setLocationSuggestionsError(null);
      setActiveLocationSuggestion(0);
      return undefined;
    }

    const sessionToken = placesSessionToken || crypto.randomUUID();
    if (!placesSessionToken) setPlacesSessionToken(sessionToken);

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLocationSuggestionsLoading(true);
      setLocationSuggestionsError(null);
      try {
        const data = await getCalendarPlaceSuggestions(trimmedQuery, sessionToken);
        if (cancelled) return;
        setLocationSuggestions(data?.places || []);
        setActiveLocationSuggestion(0);
      } catch (err) {
        if (cancelled) return;
        setLocationSuggestions([]);
        setLocationSuggestionsError(errorMessage(err, "Failed to search locations."));
      } finally {
        if (!cancelled) setLocationSuggestionsLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, placesSessionToken, query]);

  // Resolves and commits the suggestion, returning the resolved location
  // string — or null when the details fetch failed, so callers can leave the
  // raw @token in place instead of consuming it against an unresolved place.
  const selectLocationSuggestion = useCallback(async (suggestion: CalendarPlaceSuggestion) => {
    if (!suggestion?.placeId) return null;
    const sessionToken = placesSessionToken || crypto.randomUUID();
    if (!placesSessionToken) setPlacesSessionToken(sessionToken);
    setLocationSuggestionsLoading(true);
    setLocationSuggestionsError(null);
    try {
      const data = await getCalendarPlaceDetails(suggestion.placeId, sessionToken);
      const place = data?.place || null;
      const resolved = place?.location || suggestion.fullText || suggestion.primaryText;
      onSelectLocation?.(resolved);
      setLocationSuggestions([]);
      setActiveLocationSuggestion(0);
      setPlacesSessionToken("");
      return resolved;
    } catch (err) {
      setLocationSuggestionsError(errorMessage(err, "Failed to load place details."));
      return null;
    } finally {
      setLocationSuggestionsLoading(false);
    }
  }, [onSelectLocation, placesSessionToken]);

  const moveActiveLocationSuggestion = useCallback((delta: number) => {
    const total = locationSuggestionsRef.current.length;
    if (!total) {
      activeLocationSuggestionRef.current = 0;
      setActiveLocationSuggestion(0);
      return;
    }
    const next = (activeLocationSuggestionRef.current + delta + total) % total;
    activeLocationSuggestionRef.current = next;
    setActiveLocationSuggestion(next);
  }, []);

  const acceptActiveLocationSuggestion = useCallback(async () => {
    const suggestion = locationSuggestionsRef.current[activeLocationSuggestionRef.current];
    if (!suggestion) return false;
    return await selectLocationSuggestion(suggestion);
  }, [selectLocationSuggestion]);

  const clearLocationSuggestions = useCallback(() => {
    setLocationSuggestions([]);
    setLocationSuggestionsError(null);
    setActiveLocationSuggestion(0);
  }, []);

  const clearLocationSuggestionsError = useCallback(() => {
    setLocationSuggestionsError(null);
  }, []);

  const resetLocationSuggestions = useCallback(() => {
    setLocationSuggestions([]);
    setLocationSuggestionsLoading(false);
    setLocationSuggestionsError(null);
    setActiveLocationSuggestion(0);
    setPlacesSessionToken("");
  }, []);

  return {
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    activeLocationSuggestion,
    selectLocationSuggestion,
    moveActiveLocationSuggestion,
    acceptActiveLocationSuggestion,
    clearLocationSuggestions,
    clearLocationSuggestionsError,
    resetLocationSuggestions,
  };
}
