// Deliver pending money-feed lines (the outbox). Called after every sync; also a safe target for a
// retry timer when Slack was down.
import { NextResponse } from "next/server";
import { drain } from "@/lib/notify.ts";
import { env } from "@/lib/env.ts";
import { load, save } from "@/lib/store.ts";

export async function POST() {
  const s = await load();
  const result = await drain(s, env.slackWebhookUrl);
  await save(s);
  return NextResponse.json(result);
}

export const GET = POST;
