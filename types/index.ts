export type SenderType = "user" | "admin" | "system";
export type DeliveryStatus = "sent" | "delivered" | "read";
export type SessionStatus = "active" | "closed";
export type UserStatus = "active" | "blocked";
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface Message {
  id: string;
  session_id: string;
  sender_type: SenderType;
  content: string;
  created_at: string;
  updated_at: string;
  delivery_status: DeliveryStatus;
  client_msg_id: string | null;
}

export interface VisitorSession {
  id: string;
  session_code: string;
  created_at: string;
  last_activity_at: string;
  updated_at: string;
  status: SessionStatus;
  message_count: number;
  unanswered_count: number;
}

export interface VisitorProfile {
  name: string;
  status: UserStatus;
}

/** A visitor's wallet: a fixed USD balance valued in XMR at the live rate. */
export interface WalletQuote {
  balance_usd: number;
  balance_xmr: number;
  price_usd: number;
  /** Percent change over the last 24 hours, e.g. -0.12. */
  change_24h: number;
  source: "coinmarketcap" | "coingecko";
  /** When the price was last updated at the source (ISO). */
  updated_at: string;
}

export interface PublicConfig {
  message_max_length: number;
  rate_limit_per_minute: number;
}

export interface AdminSessionRow extends VisitorSession {
  user_id: string;
  closed_at: string | null;
  user_name: string;
  user_key_hint: string;
  user_status: UserStatus;
  /** Set when the visitor deleted the session from their own history. */
  visitor_hidden_at: string | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  /** Last 4 characters of the user's private key. */
  key_hint: string;
  created_at: string;
  last_seen_at: string;
  status: UserStatus;
  session_count: number;
  unanswered_count: number;
}

export interface AdminActivityItem {
  id: string;
  sender_type: SenderType;
  preview: string;
  created_at: string;
  session_id: string;
  session_code: string;
  user_name: string;
  user_key_hint: string;
}

export interface AdminStats {
  total_users: number;
  blocked_users: number;
  total_sessions: number;
  active_sessions: number;
  unanswered_messages: number;
  awaiting_sessions: number;
  messages_today: number;
  recent_activity: AdminActivityItem[];
}

export interface AdminProfile {
  id: string;
  email?: string;
  display_name: string;
  role: "admin" | "super_admin";
}

export interface AppConfig {
  message_max_length: number;
  rate_limit_per_minute: number;
  sessions_per_hour: number;
  updated_at: string;
}
