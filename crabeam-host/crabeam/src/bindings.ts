import { invoke } from "@tauri-apps/api/core";

export type HostInfo = {
  port: number;
  ticket: string;
};

export type SessionSnapshot = {
  viewer_count: number;
  viewers: string[];
};

export async function startHosting(): Promise<HostInfo> {
  return await invoke<HostInfo>("start_hosting");
}

export async function getSessionSnapshot(): Promise<SessionSnapshot> {
  return await invoke<SessionSnapshot>("get_session_snapshot");
}
