import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getCalendarSources } from "@/api";

export default function useCalendarSources({
  editable,
  onLoadStart,
  onLoadError,
}) {
  const [sourceGroups, setSourceGroups] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const sourceGroupsRef = useRef([]);
  const sourcesLoadedRef = useRef(false);
  const sourcesRequestRef = useRef(null);

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
