import { z } from "zod";

const EnvSchema = z.object({
  NOTION_API_KEY: z.string().min(1, "NOTION_API_KEY is required"),
  NOTION_CLIENTS_DB_ID: z.string().min(1, "NOTION_CLIENTS_DB_ID is required"),
  NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID: z
    .string()
    .min(1, "NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID is required"),
  // Optional: If provided, we will query this database to locate PDF/Looker links
  NOTION_MONTHLY_RECAPS_DB_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  // Optional: Anthropic model ID (e.g., "claude-3-5-sonnet-latest")
  ANTHROPIC_MODEL: z.string().optional(),
});

const isProd = process.env.NODE_ENV === "production";
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const parsed = EnvSchema.safeParse({
  NOTION_API_KEY: process.env.NOTION_API_KEY ?? (isProd && !isBuild ? undefined : "placeholder"),
  NOTION_CLIENTS_DB_ID: process.env.NOTION_CLIENTS_DB_ID ?? (isProd && !isBuild ? undefined : "placeholder"),
  NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID: process.env.NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID ?? (isProd && !isBuild ? undefined : "placeholder"),
  NOTION_MONTHLY_RECAPS_DB_ID: process.env.NOTION_MONTHLY_RECAPS_DB_ID ?? undefined,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? (isProd && !isBuild ? undefined : "placeholder"),
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? undefined,
});

if (!parsed.success) {
  const first = parsed.error.errors[0];
  const message = first ? `${first.path.join(".")}: ${first.message}` : "Invalid env";
  throw new Error(`Env validation failed: ${message}`);
}

export const env = parsed.data;



