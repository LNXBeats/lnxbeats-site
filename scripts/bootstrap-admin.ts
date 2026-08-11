import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const [{ promoteConfiguredAdmin }, { prisma }] = await Promise.all([
  import("@/lib/auth/admin-bootstrap"),
  import("@/lib/prisma"),
]);

promoteConfiguredAdmin()
  .then(({ changed }) => {
    console.info(changed
      ? "The configured verified account now has the ADMIN role."
      : "The configured verified account already has the ADMIN role.");
  })
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Admin bootstrap failed.");
    process.exitCode = 1;
  });
