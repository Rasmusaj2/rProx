import { HttpClient } from "../util/http";

export async function resolveUuid(http: HttpClient, name: string): Promise<string | undefined> {
  const data = await http.getJson<{ id: string; name: string }>(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    { cacheKey: `mojang:${name.toLowerCase()}`, cacheDuration: 60 * 60 * 1000 },
  );
  if (!data?.id) return undefined;
  return dashUuid(data.id);
}

export function dashUuid(id: string): string {
  const raw = id.replace(/-/g, "");
  if (raw.length !== 32) return id;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}
