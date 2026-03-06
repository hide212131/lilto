import Electrobun, { Electroview } from "electrobun/view";
import type { AgentLoopEvent } from "../shared/agent-loop";
import type { AuthState } from "../main/auth-service";
import type { ProviderSettings } from "../shared/provider-settings";
import type { LiltoRPC } from "../shared/rpc-schema";

// Pub/sub listener sets for push events from bun
const loopEventListeners = new Set<(event: AgentLoopEvent) => void>();
const authStateListeners = new Set<(state: AuthState) => void>();

// Set up Electroview with typed RPC schema
const rpc = Electroview.defineRPC<LiltoRPC>({
  maxRequestTime: 60000,
  handlers: {
    requests: {},
    messages: {
      agentLoopEvent: (event: AgentLoopEvent) => {
        for (const listener of loopEventListeners) {
          listener(event);
        }
      },
      authStateChanged: (state: AuthState) => {
        for (const listener of authStateListeners) {
          listener(state);
        }
      }
    }
  }
});

const electrobun = new Electrobun.Electroview({ rpc });

// Expose window.lilto — same API surface as the original Electron preload bridge
(window as unknown as Record<string, unknown>).lilto = {
  submitPrompt: (text: string) =>
    electrobun.rpc!.request.submitPrompt({ text }),

  startClaudeOauth: () =>
    electrobun.rpc!.request.startClaudeOauth(),

  submitAuthCode: (code: string) =>
    electrobun.rpc!.request.submitAuthCode({ code }),

  getAuthState: () =>
    electrobun.rpc!.request.getAuthState(),

  getProviderSettings: () =>
    electrobun.rpc!.request.getProviderSettings(),

  saveProviderSettings: (settings: unknown) =>
    electrobun.rpc!.request.saveProviderSettings(settings as ProviderSettings),

  onAgentLoopEvent: (listener: (event: AgentLoopEvent) => void): (() => void) => {
    loopEventListeners.add(listener);
    return () => {
      loopEventListeners.delete(listener);
    };
  },

  onAuthStateChanged: (listener: (state: AuthState) => void): (() => void) => {
    authStateListeners.add(listener);
    return () => {
      authStateListeners.delete(listener);
    };
  }
};

// Import and register the Lit UI app after window.lilto is set up.
// Dynamic import ensures the custom element registration (and connectedCallback) happens
// after window.lilto is available on the window object.
void import("../renderer/app");
