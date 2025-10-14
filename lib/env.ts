import { z } from "zod";

const EnvSchema = z.object({
  NOTION_API_KEY: z.string().min(1, "NOTION_API_KEY is required"),
  NOTION_CLIENTS_DB_ID: z.string().min(1, "NOTION_CLIENTS_DB_ID is required"),
  NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID: z
    .string()
    .min(1, "NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
});

const isProd = process.env.NODE_ENV === "production";
const parsed = EnvSchema.safeParse({
  NOTION_API_KEY: process.env.NOTION_API_KEY ?? (isProd ? undefined : "placeholder"),
  NOTION_CLIENTS_DB_ID: process.env.NOTION_CLIENTS_DB_ID ?? (isProd ? undefined : "placeholder"),
  NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID: process.env.NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID ?? (isProd ? undefined : "placeholder"),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? (isProd ? undefined : "placeholder"),
});

if (!parsed.success) {
  const first = parsed.error.errors[0];
  const message = first ? `${first.path.join(".")}: ${first.message}` : "Invalid env";
  throw new Error(`Env validation failed: ${message}`);
}

export const env = parsed.data;



