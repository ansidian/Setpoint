export function buildBriefingEmailMenu(email, { onOpen, onMarkRead, onMarkUnread, onDismiss, onTrash }) {
  const isRead = !!email.read;
  return [
    { label: "Open", onSelect: onOpen },
    isRead
      ? { label: "Mark unread", onSelect: onMarkUnread }
      : { label: "Mark read", onSelect: onMarkRead },
    { type: "separator" },
    {
      label: "Remove",
      children: [
        { label: "Dismiss", onSelect: onDismiss },
        { label: "Trash", danger: true, onSelect: onTrash },
      ],
    },
  ];
}
