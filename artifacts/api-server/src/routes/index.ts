import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import departmentsRouter from "./departments";
import designationsRouter from "./designations";
import employeesRouter from "./employees";
import usersRouter from "./users";
import auditLogsRouter from "./audit-logs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(departmentsRouter);
router.use(designationsRouter);
router.use(employeesRouter);
router.use(usersRouter);
router.use(auditLogsRouter);

export default router;
