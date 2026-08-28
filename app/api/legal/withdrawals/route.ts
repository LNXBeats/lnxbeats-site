import { handleWithdrawalSubmission } from "@/lib/legal/withdrawal-route-handler";

export async function POST(request: Request) {
  return handleWithdrawalSubmission(request);
}
