type DatabaseQuery = () => Promise<unknown>;

type SequentialQueryResults<Queries extends readonly DatabaseQuery[]> = {
  readonly [Index in keyof Queries]: Queries[Index] extends () => Promise<infer Result> ? Result : never;
};

/**
 * Runs relation reads one after another when they share a transactional client.
 * PostgreSQL allows only one active query on a PoolClient; Prisma relation
 * loaders may otherwise fan sibling reads out concurrently on that client.
 */
export async function runSequentialDatabaseQueries<const Queries extends readonly DatabaseQuery[]>(
  ...queries: Queries
): Promise<SequentialQueryResults<Queries>> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query());
  return results as unknown as SequentialQueryResults<Queries>;
}
