import "express";
import type { InferSelectModel } from "drizzle-orm";
import type { hrmsUsersTable } from "@workspace/db/schema";

declare global {
  namespace Express {
    interface Request {
      hrmsUser?: InferSelectModel<typeof hrmsUsersTable>;
    }
  }
}
