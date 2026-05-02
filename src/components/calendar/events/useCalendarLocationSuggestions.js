import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCalendarPlaceDetails, getCalendarPlaceSuggestions } from "@/api";

export default function useCalendarLocationSuggestions({
  enabled,
  query,
  onSelectLocation,
}) {
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationSuggestionsLoading, setLocationSuggestionsLoading] = useState(false);
  const [locationSuggestionsError, setLocationSuggestionsError] = useState(null);
  const [activeLocationSuggestion, setActiveLocationSuggestion] = useState(0);
  const [placesSessionToken, setPlacesSessionToken] = useState("");
  const locationSuggestionsRef = useRef([]);
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
        setLocationSuggestionsError(err.message || "Failed to search locations.");
      } finally {
        if (!cancelled) setLocationSuggestionsLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, placesSessionToken, query]);

  const selectLocationSuggestion = useCallback(async (suggestion) => {
    if (!suggestion?.placeId) return;
    const sessionToken = placesSessionToken || crypto.randomUUID();
    if (!placesSessionToken) setPlacesSessionToken(sessionToken);
    setLocationSuggestionsLoading(true);
    setLocationSuggestionsError(null);
    try {
      const data = await getCalendarPlaceDetails(suggestion.placeId, sessionToken);
      const place = data?.place || null;
      onSelectLocation?.(place?.location || suggestion.fullText || suggestion.primaryText);
      setLocationSuggestions([]);
      setActiveLocationSuggestion(0);
      setPlacesSessionToken("");
    } catch (err) {
      setLocationSuggestionsError(err.message || "Failed to load place details.");
    } finally {
      setLocationSuggestionsLoading(false);
    }
  }, [onSelectLocation, placesSessionToken]);

  const moveActiveLocationSuggestion = useCallback((delta) => {
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
    await selectLocationSuggestion(suggestion);
    return true;
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
