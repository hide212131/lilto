import type { AgentLoopEvent } from "./agent-loop";
import type { ProviderSettings } from "./provider-settings";
import type { AuthState } from "../main/auth-service";

export type SubmitPromptOk = { ok: true; request: { text: string }; response: { text: string } };
export type SubmitPromptError = { ok: false; error?: { code?: string; message?: string; retryable?: boolean } };
export type SubmitPromptResult = SubmitPromptOk | SubmitPromptError;

export type AuthCodeOk = { ok: true; state: AuthState };
export type AuthCodeError = { ok: false; error: { code: string; message: string } };
export type AuthCodeResult = AuthCodeOk | AuthCodeError;

export type ProviderSettingsSaveOk = { ok: true; state: ProviderSettings };
export type ProviderSettingsSaveError = { ok: false; error: { code: string; message: string } };
export type ProviderSettingsSaveResult = ProviderSettingsSaveOk | ProviderSettingsSaveError;

/**
 * Electrobun RPC schema for lilt-o.
 *
 * Uses plain object types (structurally compatible with RPCSchema<>) so this
 * file can be imported from both the bun process and the webview bundle.
 *
 * bun.requests   = requests that the BUN side handles (webview → bun calls)
 * bun.messages   = messages the BUN side receives from webview (none here)
 * webview.requests = requests the WEBVIEW side handles (bun → webview calls, none here)
 * webview.messages = messages the WEBVIEW receives from bun (bun → webview push events)
 */
export type LiltoRPC = {
  bun: {
    requests: {
      submitPrompt: {
        params: { text: string };
        response: SubmitPromptResult;
      };
      getAuthState: {
        params?: undefined;
        response: AuthState;
      };
      startClaudeOauth: {
        params?: undefined;
        response: { ok: boolean; state: AuthState };
      };
      submitAuthCode: {
        params: { code: string };
        response: AuthCodeResult;
      };
      getProviderSettings: {
        params?: undefined;
        response: ProviderSettings;
      };
      saveProviderSettings: {
        params: ProviderSettings;
        response: ProviderSettingsSaveResult;
      };
    };
    messages: Record<never, never>;
  };
  webview: {
    requests: Record<never, never>;
    messages: {
      agentLoopEvent: AgentLoopEvent;
      authStateChanged: AuthState;
    };
  };
};
