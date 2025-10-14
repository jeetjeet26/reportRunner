export type ContextPacket = {
  client_name: string;
  community: string | null;
  month: string; // YYYY-MM
  month_label: string; // e.g., "July 2025"
  client_property_status: string;
  tracking_review_status: string;
  looker_review_status: string;
  looker_report_url: string | null;
  allowed_channels: string[];
  client_account_manager: string | null;
  pdf_local_path: string | null;
};




