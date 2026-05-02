import { useLayoutEffect, useState } from "react";

export function resolveNowMarkerTarget({ events, nowMs, cards }) {
  const inProgressIdx = events.findIndex(
    (event) => !event.allDay && event.startMs <= nowMs && event.endMs && event.endMs > nowMs,
  );

  if (inProgressIdx >= 0 && cards[inProgressIdx]) {
    const event = events[inProgressIdx];
    const progress = (nowMs - event.startMs) / (event.endMs - event.startMs);
    const measureCard = cards[inProgressIdx];
    return {
      markerTop: measureCard.offsetTop + progress * measureCard.offsetHeight,
      inProgressIdx,
      measureCard,
    };
  }

  const firstFutureIdx = events.findIndex((event) => !event.allDay && event.startMs > nowMs);

  if (firstFutureIdx === 0) {
    return { markerTop: 0, inProgressIdx: -1, measureCard: null };
  }

  if (firstFutureIdx > 0 && cards[firstFutureIdx - 1]) {
    const previousCard = cards[firstFutureIdx - 1];
    return {
      markerTop: previousCard.offsetTop + previousCard.offsetHeight,
      inProgressIdx: -1,
      measureCard: null,
    };
  }

  const lastIdx = events.length - 1;
  if (cards[lastIdx]) {
    const lastCard = cards[lastIdx];
    return {
      markerTop: lastCard.offsetTop + lastCard.offsetHeight,
      inProgressIdx: -1,
      measureCard: null,
    };
  }

  return { markerTop: null, inProgressIdx: -1, measureCard: null };
}

function measureMarkerTextSpan(card) {
  const innerCard = card.firstElementChild;
  if (!innerCard) {
    return { textSpan: null, flagInset: 0 };
  }

  const cardLeft = innerCard.getBoundingClientRect().left;
  const cardRight = innerCard.getBoundingClientRect().right;
  const flowKids = Array.from(innerCard.children).filter(
    (el) => getComputedStyle(el).position !== "absolute",
  );

  const lastKid = flowKids[flowKids.length - 1];
  const lastIsFlag =
    lastKid
    && getComputedStyle(lastKid).flexShrink === "0"
    && getComputedStyle(lastKid).flexGrow !== "1";
  const flagInset = lastIsFlag
    ? cardRight - lastKid.getBoundingClientRect().left + 16
    : 0;

  if (flowKids.length < 2) {
    return { textSpan: null, flagInset };
  }

  const start = flowKids[0].getBoundingClientRect().left - cardLeft - 12;
  let end = 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  for (const child of flowKids) {
    if (getComputedStyle(child).flexGrow === "1") {
      for (const inner of child.children) {
        const cs = getComputedStyle(inner);
        if (cs.display === "block") {
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const textW = ctx.measureText(inner.textContent).width;
          const innerLeft = inner.getBoundingClientRect().left - cardLeft;
          end = Math.max(end, innerLeft + Math.min(textW, inner.clientWidth));
        } else {
          end = Math.max(end, inner.getBoundingClientRect().right - cardLeft);
        }
      }
    } else if (!lastIsFlag || child !== lastKid) {
      end = Math.max(end, child.getBoundingClientRect().right - cardLeft);
    }
  }

  return { textSpan: { start, end: end + 6 }, flagInset };
}

export default function useNowMarkerLayout({ view, liveCalendar, nowMs, cardRefsRef }) {
  const [markerTop, setMarkerTop] = useState(null);
  const [inProgressIdx, setInProgressIdx] = useState(-1);
  const [textSpan, setTextSpan] = useState(null);
  const [flagInset, setFlagInset] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- DOM measurement must update marker state before paint. */
  useLayoutEffect(() => {
    if (view !== "today" || !liveCalendar?.length) {
      setMarkerTop(null);
      setInProgressIdx(-1);
      setTextSpan(null);
      setFlagInset(0);
      return;
    }

    const target = resolveNowMarkerTarget({
      events: liveCalendar,
      nowMs,
      cards: cardRefsRef.current,
    });
    setMarkerTop(target.markerTop);
    setInProgressIdx(target.inProgressIdx);

    if (target.measureCard) {
      const measured = measureMarkerTextSpan(target.measureCard);
      setTextSpan(measured.textSpan);
      setFlagInset(measured.flagInset);
      return;
    }

    setTextSpan(null);
    setFlagInset(0);
  }, [cardRefsRef, liveCalendar, nowMs, view]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { markerTop, inProgressIdx, textSpan, flagInset };
}
