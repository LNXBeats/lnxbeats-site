import "server-only";

import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export class OrderStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderStorageError";
  }
}
function storageRoot() {
  const mode = process.env.ORDER_UPLOAD_MODE;
  const configured = process.env.ORDER_UPLOAD_DIR;

  if (mode === "local-qa") {
    if (process.env.LNX_DATABASE_TARGET !== "lnx-studio-v060-test") {
      throw new OrderStorageError("Le stockage QA refuse cette cible.");
    }
    const root = path.resolve(configured ?? "/private/tmp/lnx-studio-v060-uploads");
    if (!root.startsWith("/private/tmp/")) throw new OrderStorageError("Le stockage QA doit rester dans /private/tmp.");
    return root;
  }

  if (mode === "local-private" && process.env.NODE_ENV !== "production") {
    const root = path.resolve(configured ?? path.join(process.cwd(), ".private/order-uploads"));
    const publicRoot = path.resolve(process.cwd(), "public");
    if (root === publicRoot || root.startsWith(`${publicRoot}${path.sep}`)) {
      throw new OrderStorageError("Les photos privées ne peuvent pas être stockées dans public/.");
    }
    return root;
  }

  throw new OrderStorageError("Le stockage privé des photos n’est pas configuré pour cet environnement.");
}

function resolveStorageKey(storageKey: string) {
  if (!/^orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(storageKey)) {
    throw new OrderStorageError("Clé de stockage invalide.");
  }
  const root = storageRoot();
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new OrderStorageError("Chemin de stockage invalide.");
  return { root, resolved };
}

export async function writePrivateOrderFile(storageKey: string, buffer: Buffer) {
  const { resolved } = resolveStorageKey(storageKey);
  await mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  await writeFile(resolved, buffer, { flag: "wx", mode: 0o600 });
}

export async function readPrivateOrderFile(storageKey: string) {
  const { resolved } = resolveStorageKey(storageKey);
  return readFile(resolved);
}

export async function deletePrivateOrderFile(storageKey: string) {
  const { resolved } = resolveStorageKey(storageKey);
  await unlink(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function clearQaOrderStorage() {
  if (process.env.ORDER_UPLOAD_MODE !== "local-qa") throw new OrderStorageError("Nettoyage refusé hors QA.");
  await rm(storageRoot(), { recursive: true, force: true });
}
