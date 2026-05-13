/**
 * Tiny id helpers. Bun ships crypto.randomUUID; we wrap it for clarity
 * and avoid scattering raw uuid calls.
 */

export const newId = (prefix?: string): string => {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
};
