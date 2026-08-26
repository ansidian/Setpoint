import {
  BaseBoxShapeUtil,
  getColorValue,
  getFontFamily,
  resizeBox,
  type SvgExportContext,
  type TLResizeInfo,
} from "tldraw";
import { ChecklistShapeCard } from "./ChecklistShapeCard";
import {
  CHECKLIST_SHAPE_TYPE,
  checklistShapeMigrations,
  checklistShapeProps,
  createChecklistItem,
  getChecklistMinHeight,
  getChecklistMinHeightForItems,
  getChecklistMinWidth,
  getChecklistStyleMetrics,
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
      h: getChecklistMinHeight(1, "m"),
      color: "black",
      font: "draw",
      size: "m",
      title: "",
      items: [createChecklistItem()],
    };
  }

  override component(shape: ChecklistShape) {
    return <ChecklistShapeCard editor={this.editor} shape={shape} />;
  }

  override getIndicatorPath(shape: ChecklistShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override onResize(shape: ChecklistShape, info: TLResizeInfo<ChecklistShape>) {
    return resizeBox(shape, info, {
      minWidth: getChecklistMinWidth(shape.props.size),
      minHeight: getChecklistMinHeightForItems(
        shape.props.items,
        shape.props.w,
        shape.props.size,
      ),
    });
  }

  override getFontFaces(shape: ChecklistShape) {
    return this.editor.getCurrentTheme().fonts[shape.props.font]?.faces ?? [];
  }

  override getText(shape: ChecklistShape) {
    return [shape.props.title, ...shape.props.items.map((item) => item.text)].filter(Boolean).join("\n");
  }

  override getAriaDescriptor(shape: ChecklistShape) {
    const completed = shape.props.items.filter((item) => item.checked).length;
    return `${shape.props.title || "Untitled checklist"}, ${completed} of ${shape.props.items.length} complete`;
  }

  override toSvg(shape: ChecklistShape, context: SvgExportContext) {
    const theme = this.editor.getCurrentTheme();
    const colors = theme.colors[context.colorMode];
    const metrics = getChecklistStyleMetrics(shape.props.size);
    const background = getColorValue(colors, shape.props.color, "noteFill");
    const border = colors.noteBorder;
    const text = getColorValue(colors, shape.props.color, "noteText");
    const accent = getColorValue(colors, shape.props.color, "solid");
    const fontFamily = getFontFamily(theme, shape.props.font);
    const checkboxTextGap = Math.max(8, metrics.rowGap);
    const textX = metrics.padding + metrics.checkboxSize + checkboxTextGap;
    const maxCharacters = Math.max(
      8,
      Math.floor((shape.props.w - textX - metrics.padding) / (metrics.fontSize * 0.55)),
    );
    const titleBaseline = metrics.padding + metrics.fontSize;
    let nextItemY = metrics.padding + metrics.titleRowHeight + metrics.sectionGap;
    const itemElements = shape.props.items.map((item) => {
      const lines = wrapForSvg(item.text, maxCharacters);
      const rowHeight = Math.max(
        metrics.rowHeight,
        lines.length * metrics.lineHeight + metrics.sectionGap,
      );
      const checkboxY = nextItemY + (rowHeight - metrics.checkboxSize) / 2;
      const firstTextBaseline = (
        nextItemY
        + (rowHeight - lines.length * metrics.lineHeight) / 2
        + metrics.fontSize
      );
      nextItemY += rowHeight + metrics.rowGap;
      return (
        <g key={item.id} opacity={item.checked ? 0.56 : 1}>
          <rect
            x={metrics.padding}
            y={checkboxY}
            width={metrics.checkboxSize}
            height={metrics.checkboxSize}
            rx="3"
            fill={item.checked ? accent : "none"}
            stroke={item.checked ? accent : text}
            strokeWidth="1.5"
          />
          {item.checked ? (
            <path
              d={`M${metrics.padding + metrics.checkboxSize * 0.22} ${checkboxY + metrics.checkboxSize * 0.52}l${metrics.checkboxSize * 0.22} ${metrics.checkboxSize * 0.22} ${metrics.checkboxSize * 0.4}-${metrics.checkboxSize * 0.48}`}
              fill="none"
              stroke={background}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          <text
            x={textX}
            y={firstTextBaseline}
            fill={text}
            fontFamily={fontFamily}
            fontSize={metrics.fontSize}
            textDecoration={item.checked ? "line-through" : undefined}
          >
            {lines.map((line, index) => (
              <tspan
                key={`${item.id}-${index}`}
                x={textX}
                dy={index === 0 ? 0 : metrics.lineHeight}
              >
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    });

    return (
      <g>
        <rect width={shape.props.w} height={shape.props.h} rx="1" fill={background} />
        <line
          x1="0"
          y1={shape.props.h - 1}
          x2={shape.props.w}
          y2={shape.props.h - 1}
          stroke={border}
          strokeWidth="2"
        />
        <text
          x={shape.props.w - metrics.padding}
          y={titleBaseline}
          textAnchor="end"
          fill={text}
          fillOpacity="0.58"
          fontFamily={fontFamily}
          fontSize={metrics.countFontSize}
          fontWeight="bold"
        >
          {shape.props.items.filter((item) => item.checked).length}/{shape.props.items.length}
        </text>
        <text
          x={metrics.padding}
          y={titleBaseline}
          fill={text}
          fontFamily={fontFamily}
          fontSize={metrics.fontSize}
          fontWeight="bold"
        >
          {truncateForSvg(shape.props.title || "Untitled checklist", maxCharacters)}
        </text>
        {itemElements}
      </g>
    );
  }
}
