import {
  BaseBoxShapeUtil,
  resizeBox,
  type SvgExportContext,
  type TLResizeInfo,
} from "tldraw";
import { ChecklistShapeCard } from "./ChecklistShapeCard";
import {
  CHECKLIST_MIN_WIDTH,
  CHECKLIST_SHAPE_TYPE,
  checklistShapeMigrations,
  checklistShapeProps,
  createChecklistItem,
  getChecklistMinHeight,
  getChecklistMinHeightForItems,
  type ChecklistShape,
} from "./checklistShapeModel";

function truncateForSvg(value: string, maxCharacters: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxCharacters) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxCharacters - 1))}…`;
}

function wrapForSvg(value: string, maxCharacters: number): string[] {
  const paragraphs = (value.trim() || "Add an item").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (word.length > maxCharacters) {
        if (line) lines.push(line);
        for (let index = 0; index < word.length; index += maxCharacters) {
          lines.push(word.slice(index, index + maxCharacters));
        }
        line = "";
      } else if (!line) {
        line = word;
      } else if (`${line} ${word}`.length <= maxCharacters) {
        line = `${line} ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["Add an item"];
}

export class ChecklistShapeUtil extends BaseBoxShapeUtil<ChecklistShape> {
  static override type = CHECKLIST_SHAPE_TYPE;
  static override props = checklistShapeProps;
  static override migrations = checklistShapeMigrations;

  override getDefaultProps(): ChecklistShape["props"] {
    return {
      w: 320,
      h: getChecklistMinHeight(1),
      title: "",
      items: [createChecklistItem()],
    };
  }

  override component(shape: ChecklistShape) {
    return <ChecklistShapeCard editor={this.editor} shape={shape} />;
  }

  override getIndicatorPath(shape: ChecklistShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }

  override onResize(shape: ChecklistShape, info: TLResizeInfo<ChecklistShape>) {
    return resizeBox(shape, info, {
      minWidth: CHECKLIST_MIN_WIDTH,
      minHeight: getChecklistMinHeightForItems(shape.props.items, shape.props.w),
    });
  }

  override getText(shape: ChecklistShape) {
    return [shape.props.title, ...shape.props.items.map((item) => item.text)].filter(Boolean).join("\n");
  }

  override getAriaDescriptor(shape: ChecklistShape) {
    const completed = shape.props.items.filter((item) => item.checked).length;
    return `${shape.props.title || "Untitled checklist"}, ${completed} of ${shape.props.items.length} complete`;
  }

  override toSvg(shape: ChecklistShape, context: SvgExportContext) {
    const background = context.isDarkMode ? "#24243a" : "#f4f1f8";
    const border = context.isDarkMode ? "#58526b" : "#c9c1d6";
    const text = context.isDarkMode ? "#cdd6f4" : "#171528";
    const muted = context.isDarkMode ? "#a6adc8" : "#69647a";
    const accent = context.isDarkMode ? "#cba6da" : "#7c3aed";
    const maxCharacters = Math.max(12, Math.floor((shape.props.w - 72) / 7));
    let nextItemY = 59;
    const itemElements = shape.props.items.map((item) => {
      const y = nextItemY;
      const lines = wrapForSvg(item.text, maxCharacters);
      nextItemY += 36 + (lines.length - 1) * 18;
      return (
        <g key={item.id} opacity={item.checked ? 0.62 : 1}>
          <rect x="14" y={y - 12} width="16" height="16" rx="4" fill={item.checked ? accent : "none"} stroke={item.checked ? accent : muted} />
          {item.checked ? <path d={`M18 ${y - 4}l3 3 5-6`} fill="none" stroke={background} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
          <text
            x="40"
            y={y}
            fill={item.checked ? muted : text}
            fontFamily="Montserrat, sans-serif"
            fontSize="12"
            textDecoration={item.checked ? "line-through" : undefined}
          >
            {lines.map((line, index) => (
              <tspan key={`${item.id}-${index}`} x="40" dy={index === 0 ? 0 : 18}>{line}</tspan>
            ))}
          </text>
        </g>
      );
    });

    return (
      <g>
        <rect width={shape.props.w} height={shape.props.h} rx="12" fill={background} stroke={border} />
        <text x={shape.props.w - 14} y="29" textAnchor="end" fill={muted} fontFamily="Montserrat, sans-serif" fontSize="9" fontWeight="600">
          {shape.props.items.filter((item) => item.checked).length}/{shape.props.items.length}
        </text>
        <text x="14" y="29" fill={text} fontFamily="Montserrat, sans-serif" fontSize="13" fontWeight="600">
          {truncateForSvg(shape.props.title || "Untitled checklist", maxCharacters)}
        </text>
        {itemElements}
      </g>
    );
  }
}
