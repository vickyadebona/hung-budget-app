import type { APIRoute } from 'astro';
import { json, readJson, str } from '@/lib/http';
import { importSheet } from '@/lib/budget';

// { text } previews with guessed columns; add { mapping } to correct the guess; add { apply: true } to import.
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  const text = str(body?.text);
  if (!body || !text) return json({ error: 'Choose a .csv file first' }, 400);
  if (text.length > 500_000) return json({ error: 'That file is too big to import (500 KB limit)' }, 413);
  try {
    return json(await importSheet(text, body.mapping, body.apply === true));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not import' }, 500);
  }
};
