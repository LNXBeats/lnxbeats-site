import { getAuthSession } from "@/lib/auth/session";
import { digitalRateLimit } from "@/lib/digital/http";
import { getPremiereVote, savePremiereVote } from "@/lib/members/votes";
import { handlePremiereVoteGet, handlePremiereVotePatch, type PremiereVoteDependencies } from "@/lib/members/votes-http";
export const dynamic = "force-dynamic";
const dependencies: PremiereVoteDependencies = { baseUrl: process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000",
  user: async () => (await getAuthSession())?.user ?? null,
  rateLimit: (id, write) => digitalRateLimit(id, write ? "premiere-vote-write" : "premiere-vote-read", write ? 30 : 120),
  get: getPremiereVote, save: savePremiereVote };
export const GET = (request: Request) => handlePremiereVoteGet(request, dependencies);
export const PATCH = (request: Request) => handlePremiereVotePatch(request, dependencies);
