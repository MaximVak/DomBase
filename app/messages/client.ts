export function requestId() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function messengerApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/messenger/" + path, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Messaging is temporarily unavailable.");
  return result as T;
}

export const messengerAction = <T>(body: Record<string, unknown>) => messengerApi<T>("actions", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export function errorMessage(error: unknown) {
  return error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError)
    ? error.message : "Could not reach the messenger. Check your connection and retry.";
}

export function messageTimestamp(value: string) {
  return Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
}

export function messageTime(value: string) {
  const date = new Date(messageTimestamp(value));
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
