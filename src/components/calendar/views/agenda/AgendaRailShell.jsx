function AgendaRailShell({
  groups,
  registerHeader,
  registerSection,
  registerRow,
  registerContent,
  getSectionProps,
  renderHeader,
  renderGroup,
}) {
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
