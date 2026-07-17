import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getCalendarSources } from "@/api";
import type { CalendarSourceGroup } from "./calendarEventEditorModel";

export interface CalendarSourcesOptions {
  editable: boolean;
  onLoadStart?: () => void;
  onLoadError?: (error: unknown) => void;
}

export default function useCalendarSources({
  editable,
  onLoadStart,
  onLoadError,
}: CalendarSourcesOptions) {
  const [sourceGroups, setSourceGroups] = useState<CalendarSourceGroup[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const sourceGroupsRef = useRef<CalendarSourceGroup[]>([]);
  const sourcesLoadedRef = useRef(false);
  const sourcesRequestRef = useRef<Promise<CalendarSourceGroup[]> | null>(null);

  useLayoutEffect(() => {
    sourceGroupsRef.current = sourceGroups;
  }, [sourceGroups]);

  useLayoutEffect(() => {
    sourcesLoadedRef.current = sourcesLoaded;
  }, [sourcesLoaded]);

  const ensureSources = useCallback(async () => {
    if (!editable) return [];
    if (sourcesLoadedRef.current) return sourceGroupsRef.current;
    if (sourcesRequestRef.current) return sourcesRequestRef.current;

    setSourcesLoading(true);
    onLoadStart?.();
    sourcesRequestRef.current = (async () => {
      const data = await getCalendarSources();
      const groups = data?.accounts || [];
      sourceGroupsRef.current = groups;
      sourcesLoadedRef.current = true;
      setSourceGroups(groups);
      setSourcesLoaded(true);
      return groups;
    })();

    try {
      return await sourcesRequestRef.current;
    } catch (err) {
      onLoadError?.(err);
      return [];
    } finally {
      sourcesRequestRef.current = null;
      setSourcesLoading(false);
    }
  }, [editable, onLoadError, onLoadStart]);

  return {
    sourceGroups,
    sourceGroupsRef,
    sourcesLoading,
    sourcesLoaded,
    ensureSources,
  };
}
