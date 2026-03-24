import { requestUrl, Notice } from "obsidian";
import type { SynologyLinkSettings } from "./settings";

export interface FileResult {
  path: string;
  name: string;
  size: number;
  isdir: boolean;
}

export class SynologyApi {
  private settings: () => SynologyLinkSettings;
  private sid: string | null = null;
  private resolvedBaseUrl: string | null = null;

  constructor(getSettings: () => SynologyLinkSettings) {
    this.settings = getSettings;
  }

  clearCache(): void {
    this.sid = null;
    this.resolvedBaseUrl = null;
  }

  async getBaseUrl(): Promise<string> {
    if (this.resolvedBaseUrl) {
      return this.resolvedBaseUrl;
    }

    const s = this.settings();

    if (s.connectionType === "direct") {
      const url = s.directUrl.replace(/\/+$/, "");
      if (!url) {
        throw new Error("Direct URL is not configured.");
      }
      this.resolvedBaseUrl = url;
      return url;
    }

    if (!s.quickConnectId) {
      throw new Error("QuickConnect ID is not configured.");
    }

    const url = await this.resolveQuickConnect(s.quickConnectId);
    this.resolvedBaseUrl = url;
    return url;
  }

  private async resolveQuickConnect(id: string): Promise<string> {
    const payload = {
      version: 1,
      command: "get_server_info",
      stop_when_error: false,
      stop_when_success: false,
      id: "dsm_portal_https",
      serverID: id,
      is_gofile: false,
    };

    let resp;
    try {
      resp = await requestUrl({
        url: "https://global.quickconnect.to/Serv.php",
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error(
        "Failed to contact QuickConnect servers. Check your internet connection."
      );
    }

    const data = resp.json;

    if (data.errno && data.errno !== 0) {
      throw new Error(
        `QuickConnect returned error ${data.errno}. Check your QuickConnect ID.`
      );
    }

    if (data.errinfo) {
      throw new Error(
        `QuickConnect error: ${data.errinfo}. Check your QuickConnect ID.`
      );
    }

    const server = data.server;
    const service = data.service;

    if (!server || !service) {
      throw new Error(
        "QuickConnect returned unexpected response. Check your QuickConnect ID."
      );
    }

    // Build candidate URLs in priority order: DDNS, FQDN, external IP
    const candidates: string[] = [];
    const port = service.ext_port || service.port || 5001;

    if (server.ddns && server.ddns !== "NULL") {
      candidates.push(`https://${server.ddns}:${port}`);
    }
    if (server.fqdn && server.fqdn !== "NULL") {
      candidates.push(`https://${server.fqdn}:${port}`);
    }
    if (server.external?.ip && server.external.ip !== "0.0.0.0") {
      candidates.push(`https://${server.external.ip}:${port}`);
    }

    // Also try LAN interfaces with internal port
    if (server.interface && Array.isArray(server.interface)) {
      const lanPort = service.port || 5001;
      for (const iface of server.interface) {
        if (iface.ip) {
          candidates.push(`https://${iface.ip}:${lanPort}`);
        }
      }
    }

    // Try each candidate with a pingpong check
    for (const candidate of candidates) {
      try {
        const pingResp = await requestUrl({
          url: `${candidate}/webman/pingpong.cgi?action=cors&quickconnect=true`,
          method: "GET",
          throw: false,
        });
        if (pingResp.status === 200 && pingResp.json?.success) {
          return candidate;
        }
      } catch {
        // Try next candidate
      }
    }

    // Fallback: try relay tunnel
    try {
      const relayResp = await requestUrl({
        url: "https://global.quickconnect.to/Serv.php",
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          command: "request_tunnel",
          stop_when_error: false,
          stop_when_success: false,
          id: "dsm_portal_https",
          serverID: id,
        }),
      });

      const relayData = relayResp.json;
      const relayService = relayData.service;
      if (relayService?.relay_ip && relayService?.relay_port) {
        const relayUrl = `https://${relayService.relay_ip}:${relayService.relay_port}`;
        return relayUrl;
      }
    } catch {
      // Fall through to error
    }

    throw new Error(
      "Could not resolve QuickConnect ID to a reachable address. Try using a direct URL instead."
    );
  }

  async authenticate(): Promise<string> {
    if (this.sid) {
      return this.sid;
    }

    const s = this.settings();
    if (!s.username || !s.password) {
      throw new Error("Username or password not configured.");
    }

    const baseUrl = await this.getBaseUrl();
    const params = new URLSearchParams({
      api: "SYNO.API.Auth",
      version: "6",
      method: "login",
      account: s.username,
      passwd: s.password,
      session: "FileStation",
      format: "sid",
    });

    let resp;
    try {
      resp = await requestUrl({
        url: `${baseUrl}/webapi/entry.cgi`,
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: params.toString(),
        throw: false,
      });
    } catch {
      throw new Error(
        "Cannot reach Synology NAS. Check your connection settings."
      );
    }

    const data = resp.json;
    if (!data.success) {
      const code = data.error?.code;
      if (code === 400) {
        throw new Error(
          "Authentication failed. Check your username and password in Synology Link settings."
        );
      } else if (code === 401) {
        throw new Error("Account is disabled.");
      } else if (code === 403 || code === 406) {
        throw new Error(
          "Two-factor authentication is required. This plugin does not support 2FA."
        );
      } else {
        throw new Error(
          `Authentication failed (error ${code}). Check your settings.`
        );
      }
    }

    this.sid = data.data.sid;
    return this.sid!;
  }

  private async authenticatedRequest(
    params: Record<string, string>,
    retried = false
  ): Promise<any> {
    const sid = await this.authenticate();
    const baseUrl = await this.getBaseUrl();

    const urlParams = new URLSearchParams({ ...params, _sid: sid });

    let resp;
    try {
      resp = await requestUrl({
        url: `${baseUrl}/webapi/entry.cgi`,
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: urlParams.toString(),
        throw: false,
      });
    } catch {
      throw new Error("Cannot reach Synology NAS. Check your connection.");
    }

    const data = resp.json;

    // Handle expired session — re-authenticate once
    if (
      !data.success &&
      (data.error?.code === 119 || data.error?.code === 106) &&
      !retried
    ) {
      this.sid = null;
      return this.authenticatedRequest(params, true);
    }

    return data;
  }

  async searchFiles(
    query: string,
    folders: string[],
    extensions: string[],
    signal?: AbortSignal
  ): Promise<FileResult[]> {
    if (!query.trim()) return [];

    // Start a search task for each folder, collect all results
    const results: FileResult[] = [];
    const taskIds: string[] = [];

    try {
      for (const folder of folders) {
        if (signal?.aborted) return [];

        const startParams: Record<string, string> = {
          api: "SYNO.FileStation.Search",
          version: "2",
          method: "start",
          folder_path: `"${folder.trim()}"`,
          pattern: `"*${query}*"`,
          recursive: "true",
        };

        if (extensions.length > 0) {
          startParams.extension = `"${extensions.join(",")}"`;
        }

        const startResp = await this.authenticatedRequest(startParams);
        if (!startResp.success) {
          console.error("Search start failed:", startResp.error);
          continue;
        }

        taskIds.push(startResp.data.taskid);
      }

      // Poll all tasks until finished or timeout
      const deadline = Date.now() + 10000; // 10 second timeout

      for (const taskId of taskIds) {
        let finished = false;

        while (!finished && Date.now() < deadline) {
          if (signal?.aborted) break;

          const listResp = await this.authenticatedRequest({
            api: "SYNO.FileStation.Search",
            version: "2",
            method: "list",
            taskid: `"${taskId}"`,
            offset: "0",
            limit: "50",
            additional: '["size"]',
          });

          if (!listResp.success) {
            break;
          }

          finished = listResp.data.finished;

          if (listResp.data.files) {
            for (const file of listResp.data.files) {
              results.push({
                path: file.path,
                name: file.name,
                size: file.additional?.size ?? 0,
                isdir: file.isdir,
              });
            }
          }

          if (!finished) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }
    } finally {
      // Clean up: stop all search tasks
      for (const taskId of taskIds) {
        try {
          await this.authenticatedRequest({
            api: "SYNO.FileStation.Search",
            version: "2",
            method: "stop",
            taskid: `"${taskId}"`,
          });
        } catch {
          // Best effort cleanup
        }
      }
    }

    // Deduplicate by path
    const seen = new Set<string>();
    return results.filter((r) => {
      if (seen.has(r.path)) return false;
      seen.add(r.path);
      return true;
    });
  }

  async getDownloadUrl(filePath: string): Promise<string> {
    const sid = await this.authenticate();
    const baseUrl = await this.getBaseUrl();

    const params = new URLSearchParams({
      api: "SYNO.FileStation.Download",
      version: "2",
      method: "download",
      path: filePath,
      mode: "open",
      _sid: sid,
    });

    return `${baseUrl}/webapi/entry.cgi?${params.toString()}`;
  }

  async testConnection(): Promise<boolean> {
    this.clearCache();
    await this.authenticate();
    return true;
  }
}
