import { requestUrl, type RequestUrlParam } from "obsidian";
import type { SynologyLinkSettings } from "./settings";

/** Timeout in ms for QuickConnect candidate probing. */
const PROBE_TIMEOUT = 8_000;
/** Timeout in ms for authentication and API requests. */
const REQUEST_TIMEOUT = 15_000;

/** Wrapper around requestUrl that rejects if the request takes too long. */
function timedRequest(
  params: RequestUrlParam,
  timeoutMs = REQUEST_TIMEOUT
) {
  return Promise.race([
    requestUrl(params),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    ),
  ]);
}

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

    const url = this.settings().url.replace(/\/+$/, "");
    if (!url) {
      throw new Error("NAS URL is not configured.");
    }

    // If it's a QuickConnect URL, resolve to the actual relay address
    if (url.includes("quickconnect.to")) {
      const resolved = await this.resolveQuickConnect(url);
      this.resolvedBaseUrl = resolved;
      return resolved;
    }

    this.resolvedBaseUrl = url;
    return url;
  }

  private async resolveQuickConnect(url: string): Promise<string> {
    // Extract QuickConnect ID from URL like https://mynas.fr1.quickconnect.to
    const match = url.match(/https?:\/\/([^.]+)\./);
    if (!match) {
      throw new Error("Could not parse QuickConnect ID from URL.");
    }
    const qcId = match[1];

    // Step 1: Ask global server
    let serverInfo = await this.fetchServerInfo(
      "https://global.quickconnect.to/Serv.php",
      qcId
    );

    // If errno=4, follow the regional redirect
    if (serverInfo.errno === 4 && serverInfo.sites?.length > 0) {
      const regional = serverInfo.sites[0];
      serverInfo = await this.fetchServerInfo(
        `https://${regional}/Serv.php`,
        qcId
      );
    }

    if (serverInfo.errno && serverInfo.errno !== 0) {
      throw new Error(
        `QuickConnect resolution failed (error ${serverInfo.errno}). Check your URL.`
      );
    }

    const service = serverInfo.service;
    if (!service) {
      throw new Error("QuickConnect returned no service info.");
    }

    // Build candidate URLs: relay first (since pingpong is typically DISCONNECTED
    // for QuickConnect users), then direct addresses
    const candidates: string[] = [];

    // Relay (most reliable for QuickConnect)
    if (service.relay_dn && service.relay_port) {
      candidates.push(`https://${service.relay_dn}:${service.relay_port}`);
    }
    if (service.relay_ip && service.relay_port) {
      candidates.push(
        `https://${service.relay_ip}:${service.relay_port}`
      );
    }

    // Direct addresses
    const server = serverInfo.server;
    if (server) {
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
    }

    // Try each candidate with a short timeout
    for (const candidate of candidates) {
      try {
        const resp = await timedRequest({
          url: `${candidate}/webapi/entry.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth`,
          method: "GET",
          throw: false,
        }, PROBE_TIMEOUT);
        if (resp.status === 200 && resp.json?.success) {
          return candidate;
        }
      } catch {
        // Try next
      }
    }

    throw new Error(
      "Could not reach NAS via QuickConnect. Check your URL and NAS connectivity."
    );
  }

  private async fetchServerInfo(
    endpoint: string,
    qcId: string
  ): Promise<any> {
    try {
      const resp = await timedRequest({
        url: endpoint,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          command: "get_server_info",
          stop_when_error: false,
          stop_when_success: false,
          id: "dsm_portal_https",
          serverID: qcId,
          is_gofile: false,
        }),
      }, PROBE_TIMEOUT);
      return resp.json;
    } catch {
      throw new Error(
        "Failed to contact QuickConnect servers. Check your internet connection."
      );
    }
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
      resp = await timedRequest({
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
      resp = await timedRequest({
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
    if (signal?.aborted) return [];

    // Use Universal Search (SYNO.Finder.FileIndexing.Search) — instant,
    // keyword-based, case-insensitive, works with multi-word queries.
    const resp = await this.authenticatedRequest({
      api: "SYNO.Finder.FileIndexing.Search",
      version: "1",
      method: "search",
      keyword: query,
      orig_keyword: query,
      query_serial: "1",
      indice: "[]",
      from: "0",
      size: "50",
      file_type: "",
      criteria_list: "[]",
      search_weight_list: JSON.stringify([
        { field: "SYNOMDSearchFileName", weight: 1, trailing_wildcard: true },
      ]),
      fields: JSON.stringify([
        "SYNOMDSharePath",
        "SYNOMDFSName",
        "SYNOMDFSSize",
        "SYNOMDIsDir",
      ]),
      sorter_field: "relevance",
      sorter_direction: "asc",
      sorter_use_nature_sort: "false",
      sorter_show_directory_first: "true",
    });

    if (!resp.success) {
      console.error("Universal Search failed:", resp.error);
      return [];
    }

    const hits: FileResult[] = [];
    const folderPrefixes = folders.map((f) => f.trim());

    for (const hit of resp.data?.hits ?? []) {
      const sharePath: string = hit.SYNOMDSharePath ?? "";
      const name: string = hit.SYNOMDFSName ?? "";
      const isdir = hit.SYNOMDIsDir === "y";

      // Filter to configured search folders
      if (
        folderPrefixes.length > 0 &&
        !folderPrefixes.some((prefix) => sharePath.startsWith(prefix))
      ) {
        continue;
      }

      // Filter by extension if configured
      if (extensions.length > 0 && !isdir) {
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (!extensions.some((e) => e.toLowerCase() === ext)) {
          continue;
        }
      }

      hits.push({
        path: sharePath,
        name,
        size: parseInt(hit.SYNOMDFSSize ?? "0", 10),
        isdir,
      });
    }

    return hits;
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
