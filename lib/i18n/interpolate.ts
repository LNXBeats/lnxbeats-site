export type MessageValues = Readonly<Record<string, string | number>>;

/** Only explicit placeholders are substituted. Values are never translated or interpreted as HTML. */
export function formatMessage(template: string, values: MessageValues = {}): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : token);
}
