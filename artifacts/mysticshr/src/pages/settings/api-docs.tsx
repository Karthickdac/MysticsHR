import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const SWAGGER_VERSION = "5";
const SWAGGER_CSS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`;
const SWAGGER_JS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`;

function ensureStylesheet(href: string) {
  if (document.querySelector(`link[data-swagger-ui="1"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.swaggerUi = "1";
  document.head.appendChild(link);
}

function ensureScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-swagger-ui="1"]`,
    );
    if (existing) {
      if ((window as any).SwaggerUIBundle) {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error("Failed to load Swagger UI")),
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.swaggerUi = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Swagger UI"));
    document.head.appendChild(script);
  });
}

export default function ApiDocsPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureStylesheet(SWAGGER_CSS);
    ensureScript(SWAGGER_JS)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const SwaggerUIBundle = (window as any).SwaggerUIBundle;
        if (!SwaggerUIBundle) {
          setError("Swagger UI failed to initialize.");
          return;
        }
        SwaggerUIBundle({
          url: `${BASE_URL}/api/openapi.json`,
          domNode: containerRef.current,
          deepLinking: true,
          persistAuthorization: true,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BookOpen className="h-6 w-6" /> API Documentation
        </h1>
        <p className="text-sm text-muted-foreground">
          Interactive reference for the MysticsHR public API. Use a key from{" "}
          <a className="underline" href={`${BASE_URL}/settings/api-keys`}>
            Settings → API Keys
          </a>{" "}
          and click <strong>Authorize</strong> below to try requests live.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reference</CardTitle>
          <CardDescription>
            Generated from the live OpenAPI spec at{" "}
            <code className="text-xs">{BASE_URL}/api/openapi.json</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-sm text-destructive">
              Could not load API docs: {error}
            </div>
          ) : (
            <div ref={containerRef} data-testid="swagger-ui-container" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
