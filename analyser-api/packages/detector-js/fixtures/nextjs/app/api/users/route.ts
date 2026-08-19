import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  const page = request.nextUrl.searchParams.get("page");
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({ body });
}
