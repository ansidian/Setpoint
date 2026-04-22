import EmptyStateSplash from "../../shared/EmptyStateSplash";

export default function EmptyState({ icon, message }) {
  const title = typeof message === "string" ? message : "No results yet";
  const body = typeof message === "string"
    ? "Try a narrower keyword, a different sender, or a more recent thread."
    : message;

  return (
    <div className="px-4 py-5">
      <EmptyStateSplash
        icon={icon}
        eyebrow="Search"
        title={title}
        message={body}
        compact
        minHeight={260}
      />
    </div>
  );
}
