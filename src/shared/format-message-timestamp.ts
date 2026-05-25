function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function formatMessageTimestamp(createdAt: number, nowMs = Date.now()): string {
  const normalizedNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const normalizedCreatedAt = Number.isFinite(createdAt) ? createdAt : normalizedNow;
  const createdDate = new Date(normalizedCreatedAt);
  const nowDate = new Date(normalizedNow);
  const timeText = `${pad2(createdDate.getHours())}:${pad2(createdDate.getMinutes())}`;

  if (isSameLocalDay(createdDate, nowDate)) {
    return timeText;
  }

  return `${createdDate.getMonth() + 1}/${createdDate.getDate()} ${timeText}`;
}