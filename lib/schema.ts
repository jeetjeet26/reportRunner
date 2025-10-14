import { z } from "zod";

// Numeric KPI map where values are numbers or null
const KpiMap = z.record(z.union([z.number(), z.null()]));

// Generic channel section: optional summary bullets and KPI map
const ChannelSection = z
  .object({
    summary: z.array(z.string()).optional(),
    kpis: KpiMap.optional(),
  })
  .strict();

// Site/Analytics section mirrors generic channel structure
const SiteSection = ChannelSection;

export const ExtractionSchema = z
  .object({
    site: SiteSection.optional(),
    google_ads: ChannelSection.optional(),
    meta_ads: ChannelSection.optional(),
    linkedin: ChannelSection.optional(),
    email_marketing: ChannelSection.optional(),
    ils: ChannelSection.optional(),

    anomalies: z.array(z.string()).optional(),
    data_quality: z.array(z.string()).optional(),
    top_keywords_or_creatives: z.array(z.string()).optional(),
  })
  .strict();

export type Extraction = z.infer<typeof ExtractionSchema>;

// JSON Schema used in prompts for strict validation by the model
export const ExtractionJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    site: { $ref: "#/$defs/channelSection" },
    google_ads: { $ref: "#/$defs/channelSection" },
    meta_ads: { $ref: "#/$defs/channelSection" },
    linkedin: { $ref: "#/$defs/channelSection" },
    email_marketing: { $ref: "#/$defs/channelSection" },
    ils: { $ref: "#/$defs/channelSection" },
    anomalies: { type: "array", items: { type: "string" } },
    data_quality: { type: "array", items: { type: "string" } },
    top_keywords_or_creatives: { type: "array", items: { type: "string" } },
  },
  required: [],
  $defs: {
    channelSection: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "array", items: { type: "string" } },
        kpis: {
          type: "object",
          additionalProperties: { type: ["number", "null"] },
        },
      },
      required: [],
    },
  },
} as const;



