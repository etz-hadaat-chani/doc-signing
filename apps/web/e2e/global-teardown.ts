import { request } from '@playwright/test';
import { seedPassword } from './helpers';

// DANGER check (5.4): after every run, no template made by a test ("בדיקה אוטומטית …") may stay
// active, or a real round could pick it. This only reports (the run fails, ids listed); it never
// archives by name, so a real template can't be touched by mistake.

const TEST_PREFIX = 'בדיקה אוטומטית';

export default async function globalTeardown() {
  const api = await request.newContext({ baseURL: 'http://localhost:5173' });
  try {
    const login = await api.post('/api/auth/login', {
      data: { email: 'manager@doc-signing.local', password: seedPassword() },
    });
    if (login.status() !== 200) throw new Error(`Teardown login failed: ${String(login.status())}`);
    const active: string[] = [];
    for (let page = 1; ; page += 1) {
      const answer = await api.get(`/api/templates?page=${String(page)}&pageSize=100`);
      const { items, total } = (await answer.json()) as {
        items: { id: string; name: string }[];
        total: number;
      };
      for (const { id, name } of items) if (name.startsWith(TEST_PREFIX)) active.push(id);
      if (items.length === 0 || page * 100 >= total) break;
    }
    if (active.length > 0) {
      throw new Error(`Test templates are still active (archive them): ${active.join(', ')}`);
    }
    console.log('Checked: no active test template ("בדיקה אוטומטית") is left.');
  } finally {
    await api.dispose();
  }
}
