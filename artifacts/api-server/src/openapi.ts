/**
 * Hand-written OpenAPI 3.0 spec for the public /api/v1 surface.
 *
 * This is intentionally separate from the internal API spec used by the
 * SPA — only endpoints meant for external integrators belong here.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MysticsHR Public API",
    version: "1.0.0",
    description:
      "Read-only HRMS data for machine-to-machine integrations. " +
      "Authenticate by sending `Authorization: Bearer mhr_live_<prefix>_<secret>` " +
      "with every request. Manage your keys under Administration → API Keys.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "mhr_live_<prefix>_<secret>",
      },
    },
    parameters: {
      Limit: {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      Offset: {
        name: "offset",
        in: "query",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    },
    schemas: {
      PageMeta: {
        type: "object",
        properties: {
          total: { type: "integer" },
          limit: { type: "integer" },
          offset: { type: "integer" },
        },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
      Employee: {
        type: "object",
        properties: {
          id: { type: "integer" },
          employeeId: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string", nullable: true },
          status: { type: "string" },
          employmentType: { type: "string" },
          dateOfJoining: { type: "string", format: "date", nullable: true },
          department: { type: "string", nullable: true },
          designation: { type: "string", nullable: true },
          location: { type: "string", nullable: true },
          // Note: compensation (ctc) is deliberately not exposed under
          // employees:read — it is reserved for a future payroll scope.
        },
      },
      Department: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          code: { type: "string" },
          description: { type: "string", nullable: true },
          isActive: { type: "boolean" },
        },
      },
      AttendanceRecord: {
        type: "object",
        properties: {
          id: { type: "integer" },
          employeeId: { type: "integer" },
          attendanceDate: { type: "string", format: "date" },
          signInTime: { type: "string", format: "date-time", nullable: true },
          signOutTime: { type: "string", format: "date-time", nullable: true },
          totalMinutesWorked: { type: "integer", nullable: true },
          overtimeMinutes: { type: "integer", nullable: true },
          status: { type: "string" },
        },
      },
      Payslip: {
        type: "object",
        properties: {
          id: { type: "integer" },
          employeeId: { type: "integer" },
          periodYear: { type: "integer" },
          periodMonth: { type: "integer" },
          generatedAt: { type: "string", format: "date-time" },
          payslipData: { type: "object", additionalProperties: true, nullable: true },
        },
      },
      LeaveBalance: {
        type: "object",
        properties: {
          id: { type: "integer" },
          employeeId: { type: "integer" },
          leaveTypeId: { type: "integer" },
          leaveType: { type: "string", nullable: true },
          leaveTypeCode: { type: "string", nullable: true },
          year: { type: "integer" },
          allocated: { type: "string" },
          used: { type: "string" },
          pending: { type: "string" },
          carryForward: { type: "string" },
        },
      },
      KeyInfo: {
        type: "object",
        properties: {
          name: { type: "string" },
          prefix: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/v1/me": {
      get: {
        summary: "Inspect the calling API key",
        tags: ["Auth"],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/KeyInfo" } } } },
          401: { description: "Invalid key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/employees": {
      get: {
        summary: "List employees",
        tags: ["Employees"],
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "departmentId", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/PageMeta" },
                    {
                      type: "object",
                      properties: {
                        data: { type: "array", items: { $ref: "#/components/schemas/Employee" } },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    "/v1/employees/{id}": {
      get: {
        summary: "Get one employee",
        tags: ["Employees"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Employee" } } } },
          404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/departments": {
      get: {
        summary: "List departments",
        tags: ["Departments"],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Department" } },
                    total: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/attendance": {
      get: {
        summary: "List attendance records",
        tags: ["Attendance"],
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
          { name: "employeeId", in: "query", schema: { type: "integer" } },
          { name: "fromDate", in: "query", schema: { type: "string", format: "date" } },
          { name: "toDate", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/PageMeta" },
                    {
                      type: "object",
                      properties: {
                        data: { type: "array", items: { $ref: "#/components/schemas/AttendanceRecord" } },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    "/v1/payslips": {
      get: {
        summary: "List payslips",
        tags: ["Payroll"],
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
          { name: "employeeId", in: "query", schema: { type: "integer" } },
          { name: "year", in: "query", schema: { type: "integer" } },
          { name: "month", in: "query", schema: { type: "integer", minimum: 1, maximum: 12 } },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/PageMeta" },
                    {
                      type: "object",
                      properties: {
                        data: { type: "array", items: { $ref: "#/components/schemas/Payslip" } },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    "/v1/leave-balances": {
      get: {
        summary: "List leave balances",
        tags: ["Leave"],
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
          { name: "employeeId", in: "query", schema: { type: "integer" } },
          { name: "year", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/PageMeta" },
                    {
                      type: "object",
                      properties: {
                        data: { type: "array", items: { $ref: "#/components/schemas/LeaveBalance" } },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
