import "server-only";

import { notificationWorkerAuthorized } from "@/lib/notifications/worker-auth";
import {
  assertResendQaFixtureCreationAllowed,
  assertResendQaHarnessEnvironment,
  databaseResendQaHarnessRepository,
  isResendQaScenario,
  type ResendQaHarnessRepository,
} from "@/lib/notifications/resend-qa-harness";

const MAXIMUM_BODY_BYTES = 1_024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export type ResendQaHarnessRouteDependencies = Readonly<{
  environment: Record<string, string | undefined>;
  repository: ResendQaHarnessRepository;
}>;

const dependencies: ResendQaHarnessRouteDependencies = {
  environment: process.env,
  repository: databaseResendQaHarnessRepository,
};

async function readBoundedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAXIMUM_BODY_BYTES) throw new Error("Body too large.");
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

type AuthenticationResult =
  | Readonly<{ ok: false; response: Response }>
  | Readonly<{ ok: true; configuration: ReturnType<typeof assertResendQaHarnessEnvironment> }>;

function authenticate(request: Request, injected: ResendQaHarnessRouteDependencies): AuthenticationResult {
  let configuration;
  try {
    configuration = assertResendQaHarnessEnvironment(injected.environment);
  } catch {
    return { ok: false, response: Response.json({ ok: false }, { status: 404, headers: NO_STORE }) };
  }
  if (!notificationWorkerAuthorized(request.headers.get("authorization"), configuration.workerSecret)) {
    return { ok: false, response: Response.json({ ok: false }, { status: 401, headers: NO_STORE }) };
  }
  return { ok: true, configuration };
}

function parseScenarioPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).length !== 1 || !("scenario" in payload) || !isResendQaScenario(payload.scenario)) return null;
  return payload.scenario;
}

export async function handleResendQaHarnessPost(
  request: Request,
  injected: ResendQaHarnessRouteDependencies = dependencies,
) {
  const authenticated = authenticate(request, injected);
  if (!authenticated.ok) return authenticated.response;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }
  let scenario;
  try {
    scenario = parseScenarioPayload(JSON.parse(await readBoundedBody(request)));
  } catch {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }
  if (!scenario) return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  try {
    assertResendQaFixtureCreationAllowed(scenario, authenticated.configuration);
  } catch {
    return Response.json({ ok: false }, { status: 403, headers: NO_STORE });
  }
  try {
    const result = await injected.repository.create(scenario);
    return Response.json({ ok: true, ...result }, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

export async function handleResendQaHarnessGet(
  request: Request,
  injected: ResendQaHarnessRouteDependencies = dependencies,
) {
  const authenticated = authenticate(request, injected);
  if (!authenticated.ok) return authenticated.response;
  const url = new URL(request.url);
  if (Array.from(url.searchParams.keys()).some((key) => key !== "scenario") || url.searchParams.getAll("scenario").length !== 1) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }
  const scenario = url.searchParams.get("scenario");
  if (!isResendQaScenario(scenario)) return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  try {
    const result = await injected.repository.read(scenario);
    if (!result) return Response.json({ ok: false }, { status: 404, headers: NO_STORE });
    return Response.json({ ok: true, ...result }, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
