type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function formatConversationStatus(status: string | null | undefined): string {
  if (!status) return "unread";
  return status;
}

export function formatFollowerStatus(status: string | null | undefined): string {
  if (!status) return "unknown";
  return status;
}

export function getStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "unread":
      return "destructive";
    case "in_progress":
      return "default";
    case "resolved":
      return "secondary";
    case "custom":
      return "outline";
    default:
      return "secondary";
  }
}

export function formatTimestamp(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const date = new Date(ts * 1000);
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
