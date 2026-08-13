export function assertSafeLocalPostgresUrl(rawValue: string, label = "DATABASE_URL") {
  const url = new URL(rawValue);
  if (!(["postgres:", "postgresql:"] as string[]).includes(url.protocol)) {
    throw new Error(`${label} must target PostgreSQL.`);
  }
  if (!(["127.0.0.1", "localhost", "::1"] as string[]).includes(url.hostname) || !url.port || url.port === "5432") {
    throw new Error(`${label} must use the isolated loopback PostgreSQL runtime on a non-default port.`);
  }
  for (const name of url.searchParams.keys()) {
    if (name !== "schema" && name !== "sslmode") {
      throw new Error(`${label} contains an unsupported connection parameter.`);
    }
  }
  const schema = url.searchParams.getAll("schema");
  if (schema.length > 1 || (schema.length === 1 && schema[0] !== "public")) {
    throw new Error(`${label} contains an invalid schema parameter.`);
  }
  const sslmode = url.searchParams.getAll("sslmode");
  if (sslmode.length > 1 || (sslmode.length === 1 && sslmode[0] !== "disable")) {
    throw new Error(`${label} contains an invalid sslmode parameter.`);
  }
  return url;
}
