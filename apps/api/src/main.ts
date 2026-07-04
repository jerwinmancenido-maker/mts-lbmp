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

app.enableCors({
  origin: true,
  credentials: true
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
