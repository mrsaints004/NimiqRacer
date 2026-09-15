export class ValidationError extends Error {}

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function str(value, { field, maxLen = 64, required = true, fallback = "", alphanumeric = false }) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError(`${field} is required`);
    return fallback;
  }
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim().slice(0, maxLen);
  if (required && trimmed.length === 0) throw new ValidationError(`${field} is required`);
  if (alphanumeric && trimmed && !SAFE_NAME_RE.test(trimmed)) {
    throw new ValidationError(`${field} may only contain letters, numbers, hyphens, and underscores`);
  }
  return trimmed;
}

export function num(value, { field, min = -Infinity, max = Infinity, integer = false, fallback = 0 }) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  if (integer && !Number.isInteger(n)) throw new ValidationError(`${field} must be an integer`);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
  return n;
}
