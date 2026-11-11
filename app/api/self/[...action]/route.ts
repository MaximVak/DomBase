import { handleSelfPhoto } from "../../../../documents/server";
import { handleSelf } from "../../../../self/server";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => new URL(request.url).pathname.startsWith("/api/self/photo/") ? handleSelfPhoto(request) : handleSelf(request);
export const POST = GET;
export const PUT = GET;
