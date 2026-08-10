export function isSameOriginMutation(request: Request, trustedBaseUrl: string) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(trustedBaseUrl).origin;
  } catch {
    return false;
  }
}
