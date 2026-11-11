import type { createAccessService } from "../access/service";
import type { KioskOperatorDatabase } from "../kiosk/database";
export type Context = Awaited<ReturnType<ReturnType<typeof createAccessService>["workspaceContext"]>>;
export type Database = KioskOperatorDatabase;
