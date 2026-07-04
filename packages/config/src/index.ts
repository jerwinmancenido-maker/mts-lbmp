export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const runtimeConfig = {
  apiPort: Number(process.env.PORT ?? 4100),
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100"
};
