import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { resolve } from "node:path";
import { AppModule } from "./modules/app.module.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule);

type MiddlewareResponse = {
  setHeader: (name: string, value: string) => void;
};

type MiddlewareNext = () => void;

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-origin" }
  })
);
app.use((_request: unknown, response: MiddlewareResponse, next: MiddlewareNext) => {
  response.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  next();
});

/**
 * Phase 5 P5-3: CORS is an env-driven allow-list (CORS_ORIGINS,
 * comma-separated), replacing `origin: true`, which reflected any
 * origin with credentials allowed. When CORS_ORIGINS is unset, the
 * defaults are the local-dev origins only: the Next.js dev server and
 * the Capacitor shell. Production deployments must set CORS_ORIGINS to
 * the real web origin(s) — see .env.example.
 */
const corsAllowList = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const localDevCorsOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "capacitor://localhost",
  "http://localhost"
];
app.enableCors({
  origin: corsAllowList.length ? corsAllowList : localDevCorsOrigins,
  credentials: true,
  // Phase 5 P5-5: the web shell reads the guard's refusal-kind header
  // (x-auth-failure: session | permission) to route expired sessions
  // back to the login screen; browsers only expose listed headers.
  exposedHeaders: ["x-auth-failure"]
});
app.useBodyParser("json", { limit: "8mb" });
app.useBodyParser("urlencoded", { limit: "8mb", extended: true });
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true
  })
);
app.useStaticAssets(resolve(process.env.INIT_CWD ?? process.cwd(), "storage/test-uploads"), {
  prefix: "/uploads/"
});

const port = Number(process.env.PORT ?? 4100);
await app.listen(port);
console.log(`MTS LBMP API running on http://localhost:${port}`);
