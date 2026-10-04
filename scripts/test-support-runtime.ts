/** Compatibility entry point. The former owner-only harness has been replaced
 * by the stricter non-owner PostgreSQL suite (including actual process crash).
 * Requires MIGRATION_DATABASE_URL to the guarded disposable local database.
 * Providers remain doubles; this is never a real sandbox certification. */
await import("./test-support-completion");
export {};
