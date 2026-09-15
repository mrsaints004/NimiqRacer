export const toHexColor = (color?: number): string | undefined =>
  color === undefined ? undefined : `#${color.toString(16).padStart(6, "0")}`;
