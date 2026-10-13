import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Login cannot submit credentials in a native GET before hydration", async () => {
  const source = await readFile(new URL("../../components/auth/login-form.tsx", import.meta.url), "utf8");
  assert.match(source, /<form method="post"/);
  assert.match(source, /\[hydrated, setHydrated\] = useState\(false\)/);
  assert.match(source, /useEffect\(\(\) => setHydrated\(true\), \[\]\)/);
  assert.match(source, /disabled=\{pending \|\| !hydrated\}/);
  assert.ok(source.includes("event.preventDefault()"));
  assert.ok(source.includes("authClient.signIn.email({ email, password, rememberMe: true })"));
  assert.ok(!source.includes("URLSearchParams"));
});
