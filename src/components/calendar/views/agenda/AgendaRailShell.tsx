import type { HTMLAttributes, MutableRefObject, ReactNode, RefCallback } from "react";

export interface AgendaRailGroup { dateKey: string }

export type AgendaNodeRegistration = (dateKey: string, node: HTMLElement | null) => void;

export interface AgendaRailShellProps<TGroup extends AgendaRailGroup> {
  groups: TGroup[];
  registerHeader: AgendaNodeRegistration;
  registerSection: AgendaNodeRegistration;
  registerRow: (itemId: string, node: HTMLElement | null, dateKey?: string) => void;
  registerContent: AgendaNodeRegistration;
  getSectionProps?: (group: TGroup) => HTMLAttributes<HTMLElement> & {
    ref?: RefCallback<HTMLElement> | MutableRefObject<HTMLElement | null>;
  };
  renderHeader?: (input: { group: TGroup; registerHeader: AgendaNodeRegistration }) => ReactNode;
  renderGroup?: (input: {
    group: TGroup;
    registerRow: AgendaRailShellProps<TGroup>["registerRow"];
    registerContent: AgendaNodeRegistration;
  }) => ReactNode;
}

function AgendaRailShell<TGroup extends AgendaRailGroup>({
  groups,
  registerHeader,
  registerSection,
  registerRow,
  registerContent,
  getSectionProps,
  renderHeader,
  renderGroup,
}: AgendaRailShellProps<TGroup>) {
  return groups.map((group) => {
    const sectionProps = getSectionProps?.(group) || {};
    const { ref: sectionPropRef, ...restSectionProps } = sectionProps;
    return (
      <section
        key={group.dateKey}
        ref={(node) => {
          registerSection(group.dateKey, node);
          if (typeof sectionPropRef === "function") sectionPropRef(node);
          else if (sectionPropRef) sectionPropRef.current = node;
        }}
        data-date-key={group.dateKey}
        {...restSectionProps}
        style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, paddingBottom: 14 }}
      >
        {renderHeader?.({ group, registerHeader })}
        {renderGroup?.({ group, registerRow, registerContent })}
      </section>
    );
  });
}

export default AgendaRailShell;
