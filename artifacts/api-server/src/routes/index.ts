import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import departmentsRouter from "./departments";
import designationsRouter from "./designations";
import employeesRouter from "./employees";
import rolesRouter from "./roles";
import usersRouter from "./users";
import auditLogsRouter from "./audit-logs";
import recruitmentRouter from "./recruitment";
import preOnboardingRouter from "./pre-onboarding";
import employeesExtendedRouter from "./employees-extended";
import onboardingRouter from "./onboarding";
import shiftsRouter from "./shifts";
import attendanceRouter from "./attendance";
import leaveRouter from "./leave";
import permissionsRouter from "./permissions";
import payrollRouter from "./payroll";
import performanceRouter from "./performance";
import helpdeskRouter from "./helpdesk";
import documentsRouter from "./documents";
import exitRouter from "./exit";
import reportsRouter from "./reports";
import notificationsRouter from "./notifications";
import systemConfigRouter from "./system-config";
import storageRouter from "./storage";
import apiKeysRouter from "./api-keys";
import v1Router from "./v1";
import { openApiSpec } from "../openapi";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(departmentsRouter);
router.use(designationsRouter);
router.use(employeesRouter);
router.use(rolesRouter);
router.use(usersRouter);
router.use(recruitmentRouter);
router.use(preOnboardingRouter);
router.use(employeesExtendedRouter);
router.use(onboardingRouter);
router.use(shiftsRouter);
router.use(attendanceRouter);
router.use(leaveRouter);
router.use(permissionsRouter);
router.use(payrollRouter);
router.use(performanceRouter);
router.use(helpdeskRouter);
router.use(documentsRouter);
router.use(exitRouter);
router.use(reportsRouter);
router.use(notificationsRouter);
router.use(systemConfigRouter);
router.use(storageRouter);
router.use(auditLogsRouter);
router.use(apiKeysRouter);
router.use("/v1", v1Router);

router.get("/openapi.json", (_req, res) => res.json(openApiSpec));

// Swagger UI loaded from CDN — no extra dependency, no build step.
router.get("/docs", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MysticsHR API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      persistAuthorization: true,
    });
  </script>
</body>
</html>`);
});

export default router;
