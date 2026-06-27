export interface Session {
  id: string;
  title: string;
  provider: string;
  model: string;
  status: string;
  tokens: number;
  latency: string;
  cost: string;
  user_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool_result";
  content: string;
  tokens: number;
  latency: string;
  created_at?: string;
}

/** Parsed structured assistant response stored as JSON in Message.content */
export interface AssistantResponse {
  text: string;
  thinking?: string;
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    service_tier?: string;
  };
}

/** Anthropic-style content block (also used by some OpenAI multi-modal payloads) */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id?: string; name: string; input?: Record<string, unknown> }
  | {
      type: "tool_result";
      tool_use_id?: string;
      content: string | ContentBlock[];
      is_error?: boolean;
    }
  | { type: "image"; source?: { media_type?: string; data?: string; url?: string } }
  | { type: string;[k: string]: unknown };

export interface RequestLog {
  id: number;
  request_id: string;
  session_id: string;
  provider: string;
  model: string;
  status_code: number;
  latency_ms: number;
  tokens: number;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
  cost: string;
  response_body: string;
  request_body: string;
  created_at: string;
}

export interface Endpoint {
  id: number;
  display_name: string;
  provider_name: string;
  provider_key: string;
  endpoint_url: string;
  model_name: string;
  api_key_masked: string;
  gateway_key: string;
  status: string;
  latency_ms: number;
  error_rate: number;
  enabled: number;
  price_input_per_m: number;
  price_output_per_m: number;
  price_cache_input_per_m: number;
}

export interface EndpointCreateRequest {
  display_name: string;
  provider_name: string;
  provider_key: string;
  endpoint_url: string;
  model_name: string;
  api_key: string;
}

export interface UsageStats {
  totalTokens: string;
  totalRequests: string;
  avgLatency: string;
  estimatedCost: string;
  cacheHitRate: string;
}

export type UserRole = "admin" | "user";

export interface User {
  id: number;
  username: string;
  display_name: string | null;
  role: UserRole;
  created_at?: string;
  updated_at?: string;
}

export interface AuthSession {
  id: string;
  user_id: number;
  token: string;
  expires_at: number;
  created_at: string;
}

export interface AuthContext {
  user: User;
  token: string;
}

export type Section = "session-monitor" | "logs" | "endpoints" | "usage" | "users" | "login";
