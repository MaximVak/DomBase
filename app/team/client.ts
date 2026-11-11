export async function teamRequest<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/team/${path}`, { cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }); const result = await r.json(); if (!r.ok) throw new Error(result.error || "Team request failed."); return result;
}
export const saveId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
