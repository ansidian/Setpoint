import { memo } from "react";
import type { ReactNode } from "react";
import { isDemoMode } from "../../demo/config.ts";

type AlfredRichBlock =
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[]; start: number };

// Deliberately small Markdown subset for model output. React escapes all text,
// raw HTML is never interpreted, and links only become anchors when the target
// is explicitly http(s).
const INLINE_RE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/gi;
const UNORDERED_ITEM_RE = /^\s*[-*+]\s+(.+)$/;
const ORDERED_ITEM_RE = /^\s*(\d+)[.)]\s+(.+)$/;

function inlineNodes(value: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;

  for (const match of value.matchAll(INLINE_RE)) {
    if (match.index > last) nodes.push(value.slice(last, match.index));
    const key = `${keyBase}-${index++}`;
    if (match[2] != null) nodes.push(<strong key={key} style={{ fontWeight: 600, color: "var(--sp-text)" }}>{match[2]}</strong>);
    else if (match[3] != null) nodes.push(<strong key={key} style={{ fontWeight: 600, color: "var(--sp-text)" }}>{match[3]}</strong>);
    else if (match[4] != null) nodes.push(<em key={key}>{match[4]}</em>);
    else if (match[5] != null) nodes.push(<em key={key}>{match[5]}</em>);
    else if (match[6] != null) nodes.push(
      <code key={key} style={{
        padding: "1px 4px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.06)",
        color: "var(--sp-text)",
        fontFamily: "var(--font-mono, 'Fira Code', ui-monospace, monospace)",
        fontSize: "0.9em",
      }}>{match[6]}</code>,
    );
    else if (match[7] != null) nodes.push(isDemoMode()
      ? match[7]
      : <a
          key={key}
          href={match[8]}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-[2px] transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          style={{ color: "var(--ea-accent, var(--sp-accent))", textDecoration: "underline", textUnderlineOffset: 2 }}
        >{match[7]}</a>);
    last = match.index + match[0].length;
  }

  if (last < value.length) nodes.push(value.slice(last));
  return nodes;
}

function parseBlocks(value: string): AlfredRichBlock[] {
  const blocks: AlfredRichBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<AlfredRichBlock, { type: "unordered-list" | "ordered-list" }> | null = null;

  function flushParagraph(): void {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  }

  function flushList(): void {
    if (!list) return;
    blocks.push(list);
    list = null;
  }

  for (const rawLine of String(value || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const unordered = rawLine.match(UNORDERED_ITEM_RE);
    if (unordered) {
      flushParagraph();
      if (list?.type !== "unordered-list") {
        flushList();
        list = { type: "unordered-list", items: [] };
      }
      list.items.push(unordered[1]!.trim());
      continue;
    }

    const ordered = rawLine.match(ORDERED_ITEM_RE);
    if (ordered) {
      flushParagraph();
      if (list?.type !== "ordered-list") {
        flushList();
        list = { type: "ordered-list", items: [], start: Number(ordered[1]) || 1 };
      }
      list.items.push(ordered[2]!.trim());
      continue;
    }

    if (list && /^\s{2,}\S/.test(rawLine) && list.items.length) {
      const lastItem = list.items.length - 1;
      list.items[lastItem] = `${list.items[lastItem]} ${rawLine.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(rawLine.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

function openingParagraphNodes(value: string): ReactNode {
  const trimmed = value.trim();
  // Respect explicit leading emphasis from the model instead of nesting it.
  if (/^(?:\*\*|__)/.test(trimmed)) return inlineNodes(trimmed, "opening");

  const sentence = trimmed.match(/[.!?](?:\s|$)/);
  const cut = sentence?.index != null ? sentence.index + 1 : trimmed.length;
  const opening = trimmed.slice(0, cut).trim();
  const rest = trimmed.slice(cut).trim();
  return (
    <>
      <strong style={{ fontWeight: 600, color: "var(--sp-text)" }}>{inlineNodes(opening, "opening-lead")}</strong>
      {rest ? <> {inlineNodes(rest, "opening-rest")}</> : null}
    </>
  );
}

function AlfredRichText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div data-alfred-rich-text style={{ display: "grid", gap: 8 }}>
      {blocks.map((block, blockIndex) => {
        if (block.type === "paragraph") {
          return (
            <p key={blockIndex} style={{ margin: 0 }}>
              {blockIndex === 0
                ? openingParagraphNodes(block.text)
                : inlineNodes(block.text, `paragraph-${blockIndex}`)}
            </p>
          );
        }

        const listStyle = {
          display: "grid",
          gap: 4,
          margin: 0,
          paddingInlineStart: 20,
        } as const;
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex} style={{ paddingInlineStart: 2, color: "rgba(205,214,244,0.48)" }}>
            <span style={{ color: "rgba(205,214,244,0.86)" }}>
              {inlineNodes(item, `list-${blockIndex}-${itemIndex}`)}
            </span>
          </li>
        ));

        return block.type === "unordered-list"
          ? <ul key={blockIndex} style={listStyle}>{items}</ul>
          : <ol key={blockIndex} start={block.start} style={listStyle}>{items}</ol>;
      })}
    </div>
  );
}

export default memo(AlfredRichText);
