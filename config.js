/* =====================================================================
   PushUP — public runtime config.
   ONLY public values belong here. The service_role key must NEVER appear
   in this repo; it lives solely in GAS ScriptProperties.
   ===================================================================== */
window.PUSHUP_CONFIG = {
  // ---- Supabase (public anon key only) ----
  SUPABASE_URL:        "https://hefjcizqisaavuiflxcl.supabase.co",            // e.g. https://xxxx.supabase.co
  SUPABASE_ANON_KEY:   "sb_publishable_5p8RwAKIr7i0UBcwMx9F_g_4ycCVhJ3",

  // ---- OneSignal v16 ----
  ONESIGNAL_APP_ID:    "c11a2e50-2d48-4d50-a89c-278a32a093f0",

  // ---- GAS web app (contact form + math CAPTCHA) ----
  GAS_WEBAPP_URL:      "https://script.google.com/macros/s/AKfycbwdhdVdzMdm7x4LoFolTMwWd50vIRXRHboTOefOLhcKf1pIQLLtxylKIhjwBRiHoHRa/exec",

  // ---- Table / RPC names (Stage A prefix) ----
  TBL_MESSAGES:        "pushup_messages",
  TBL_EVENTS:          "pushup_events",
  TBL_VIDEOS:          "pushup_videos",
  TBL_PHOTOS:          "pushup_photos",
  VIEW_FEEDBACK_COUNTS:"pushup_feedback_counts",
  RPC_SUBMIT_FEEDBACK: "pushup_submit_feedback",
  RPC_RECORD_VIEWS:    "pushup_record_views",
  RPC_LOG_CLICK:       "pushup_log_click",
  RPC_UPSERT_SUB:      "pushup_upsert_subscription",

  // ---- Behaviour ----
  PAGE_SIZE:           20,
  PHOTO_PAGE_SIZE:     20,
  SEARCH_DEBOUNCE_MS:  400,
  DEFAULT_GROUP:       "all",
  ASSET_VERSION:       "1.0.0"
};
