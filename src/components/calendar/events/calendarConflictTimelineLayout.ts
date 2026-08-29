export interface ConflictTimelineLayoutInput {
  id: string;
  top: number;
  height: number;
  draft?: boolean;
}

export interface ConflictTimelineLayoutItem extends ConflictTimelineLayoutInput {
  lane: number;
  laneCount: number;
}

export function resolveConflictTimelineHeight(
  baseHeight: number,
  blocks: Array<Pick<ConflictTimelineLayoutInput, "top" | "height">>,
  bottomInset: number,
) {
  return Math.max(
    baseHeight,
    ...blocks.map((block) => block.top + block.height + bottomInset),
  );
}

export function layoutConflictTimelineItems(
  items: ConflictTimelineLayoutInput[],
): ConflictTimelineLayoutItem[] {
  // Partition rendered rectangles, not source time ranges: short events still
  // occupy the timeline's minimum card height and can visually collide.
  const sorted = items
    .map((item, sourceIndex) => ({ ...item, sourceIndex, bottom: item.top + item.height }))
    .sort((a, b) => (
      a.top - b.top
      || Number(!!a.draft) - Number(!!b.draft)
      || b.height - a.height
      || a.sourceIndex - b.sourceIndex
    ));
  const positioned: Array<ConflictTimelineLayoutItem & { sourceIndex: number }> = [];
  let group: typeof sorted = [];
  let groupBottom = Number.NEGATIVE_INFINITY;

  const flushGroup = () => {
    if (!group.length) return;
    const laneBottoms: number[] = [];
    const groupItems = group.map((item) => {
      const reusableLane = laneBottoms.findIndex((bottom) => bottom <= item.top);
      const lane = reusableLane === -1 ? laneBottoms.length : reusableLane;
      laneBottoms[lane] = item.bottom;
      return { ...item, lane };
    });
    const laneCount = laneBottoms.length;
    positioned.push(...groupItems.map(({ bottom: _bottom, ...item }) => ({ ...item, laneCount })));
    group = [];
    groupBottom = Number.NEGATIVE_INFINITY;
  };

  for (const item of sorted) {
    if (group.length && item.top >= groupBottom) flushGroup();
    group.push(item);
    groupBottom = Math.max(groupBottom, item.bottom);
  }
  flushGroup();

  return positioned
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map(({ sourceIndex: _sourceIndex, ...item }) => item);
}
