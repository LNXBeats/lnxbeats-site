import { toNextJsHandler } from "better-auth/next-js";

import { handleAuthRequest } from "@/lib/auth/handler";

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(handleAuthRequest);
