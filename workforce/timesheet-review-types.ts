export const noShowReasons = ["Called out", "No notice", "Schedule changed", "Other"] as const;
export const reviewBatchLimit = 2000;
export type ReviewAction = "approve" | "resolve" | "no_show";
export type ReviewTarget = Pick<ReviewItem, "key" | "version">;
export type ReviewItem = {
  key: string;
  version: string;
  kind: "card" | "no-show";
  employeeId: number;
  employee: string;
  date: string;
  role: string;
  department: string;
  start: string;
  end?: string;
  firstEventId?: number;
  lockable?: boolean;
  workedMinutes?: number;
  issues: string[];
  status: "needs-review" | "ready" | "approved" | "resolved-no-show";
  allowedAction?: ReviewAction;
  decision?: { at: string; actor: string; reason: string; note: string };
};

export type TimesheetReview = { items: ReviewItem[] };
