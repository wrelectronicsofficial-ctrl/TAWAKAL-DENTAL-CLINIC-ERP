const API_BASE = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/$/, '');

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalized}` : normalized;
}

export async function readJsonSafe<T = Record<string, unknown>>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    if (res.status === 404 || text.trimStart().startsWith('<')) {
      throw new Error(
        'Backend API server is unavailable on static hosting. Full AI, Excel, Backup, WordPress, and Microsoft Graph APIs require the Node.js Express server (Cloud Run / Firebase App Hosting) or VITE_API_BASE_URL.'
      );
    }
    throw new Error(text || `Unexpected server response (${res.status})`);
  }
  return (await res.json()) as T;
}
