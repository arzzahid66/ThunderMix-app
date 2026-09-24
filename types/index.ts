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
  email: string;
  status: UserStatus;
}

export interface PublicConfig {
  message_max_length: number;
  rate_limit_per_minute: number;
}

export interface AdminSessionRow extends VisitorSession {
  user_id: string;
  closed_at: string | null;
  user_name: string;
  user_email: string;
  user_status: UserStatus;
  /** Set when the visitor deleted the session from their own history. */
  visitor_hidden_at: string | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
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
  user_email: string;
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
