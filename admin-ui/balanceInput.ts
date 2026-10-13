/** Same ceiling as the server Megacoin wallet. */
export const ADMIN_BALANCE_MAX = 999_999_999;

export function parseAdminBalance(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Введите баланс.' };
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Баланс должен быть целым числом от 0.' };
  if (text.length > 15) return { ok: false, message: 'Баланс слишком большой.' };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > ADMIN_BALANCE_MAX) {
    return { ok: false, message: 'Баланс слишком большой.' };
  }
  return { ok: true, value };
}
