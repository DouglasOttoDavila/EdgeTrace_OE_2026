import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const promptPathByWorkflow = {
  generate_test_cases: ".github/prompts/02-jira-testrail-rpi.prompt.md",
  generate_automation: ".github/prompts/04-testrail-vibium-playwright-rpi.prompt.md"
} as const;

const requiredMcpServerNamesByWorkflow = {
  generate_test_cases: ["testrail"],
  generate_automation: ["testrail", "playwright"]
} as const;

const preferredMcpServerNamesByWorkflow = {
  generate_test_cases: ["testrail", "n8n-mcp", "n8n-mcp-basic"],
  generate_automation: ["testrail", "playwright"]
} as const;

type RawMcpServerConfig = {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  tools?: string[];
  url?: string;
  headers?: Record<string, string>;
};

type RawMcpConfigFile = {
  servers?: Record<string, RawMcpServerConfig>;
};

let managedCliProcess: ChildProcessWithoutNullStreams | undefined;

const resolveCliCommand = (): string => {
  if (process.env.COPILOT_CLI_PATH) {
    return process.env.COPILOT_CLI_PATH;
  }

  if (process.platform !== "win32") {
    return "copilot";
  }

  try {
    const output = execFileSync("where", ["copilot"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const firstPath = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (firstPath) {
      return firstPath;
    }
  } catch {
    return "copilot";
  }

  return "copilot";
};

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isServerReachable = async (host: string, port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const onDone = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once("connect", () => onDone(true));
    socket.once("error", () => onDone(false));
    socket.setTimeout(800, () => onDone(false));
  });
};

const ensureManagedCliServer = async (cliCommand: string, port: number): Promise<string> => {
  const host = "127.0.0.1";
  if (await isServerReachable(host, port)) {
    return `${host}:${port}`;
  }

  if (!managedCliProcess || managedCliProcess.exitCode !== null) {
    const isWindows = process.platform === "win32";
    const commandForShell = cliCommand.includes(" ") ? `"${cliCommand}"` : cliCommand;

    managedCliProcess = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", `${commandForShell} --headless --port ${port}`], {
          cwd: workspaceRoot,
          env: process.env,
          stdio: "pipe"
        })
      : spawn(cliCommand, ["--headless", "--port", String(port)], {
          cwd: workspaceRoot,
          env: process.env,
          stdio: "pipe"
        });
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isServerReachable(host, port)) {
      return `${host}:${port}`;
    }
    await sleep(300);
  }

  let stderrOutput = "";
  if (managedCliProcess?.stderr) {
    try {
      stderrOutput = managedCliProcess.stderr.read()?.toString() || "";
    } catch {
      stderrOutput = "";
    }
  }

  throw new Error(
    `Unable to start Copilot CLI headless server on ${host}:${port}. ${stderrOutput}`.trim()
  );
};

const resolveMcpConfigPath = (): string => {
  if (process.env.COPILOT_MCP_CONFIG_PATH) {
    return process.env.COPILOT_MCP_CONFIG_PATH;
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Code", "User", "mcp.json");
  }

  return path.join(os.homedir(), ".config", "Code", "User", "mcp.json");
};

const normalizeMcpServerConfig = (name: string, server: RawMcpServerConfig): Record<string, unknown> => {
  const rawType = (server.type || "").toLowerCase();
  const normalizedType = rawType === "stdio" || rawType === "local" ? "local" : rawType || (server.url ? "http" : "local");
  const tools = Array.isArray(server.tools) && server.tools.length > 0 ? server.tools : ["*"];

  if (normalizedType === "http" || normalizedType === "sse") {
    if (!server.url) {
      throw new Error(`MCP server '${name}' is missing required 'url' for type '${normalizedType}'.`);
    }

    return {
      type: normalizedType,
      url: server.url,
      headers: server.headers,
      timeout: server.timeout,
      tools
    };
  }

  if (!server.command) {
    throw new Error(`MCP server '${name}' is missing required 'command' for local/stdio type.`);
  }

  return {
    type: "local",
    command: server.command,
    args: Array.isArray(server.args) ? server.args : [],
    env: server.env,
    cwd: server.cwd,
    timeout: server.timeout,
    tools
  };
};

const loadMcpServersForWorkflow = async (
  workflowType: keyof typeof promptPathByWorkflow
): Promise<{ configPath: string; mcpServers: Record<string, Record<string, unknown>> }> => {
  const configPath = resolveMcpConfigPath();
  let parsed: RawMcpConfigFile;

  try {
    const text = await readFile(configPath, "utf8");
    parsed = JSON.parse(text) as RawMcpConfigFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load MCP config at '${configPath}'. ${message}`);
  }

  const servers = parsed.servers || {};
  const requiredNames = requiredMcpServerNamesByWorkflow[workflowType];
  const missingNames = requiredNames.filter((name) => !servers[name]);
  if (missingNames.length > 0) {
    throw new Error(
      `MCP config at '${configPath}' is missing required server(s) for ${workflowType}: ${missingNames.join(", ")}.`
    );
  }

  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(servers)) {
    normalized[name] = normalizeMcpServerConfig(name, server);
  }

  return {
    configPath,
    mcpServers: normalized
  };
};

const selectMcpServersForWorkflow = (
  workflowType: keyof typeof promptPathByWorkflow,
  allServers: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> => {
  const selectedNames: string[] = [...preferredMcpServerNamesByWorkflow[workflowType]];

  const includeVibium = process.env.COPILOT_ENABLE_VIBIUM_MCP === "true";
  if (workflowType === "generate_automation" && includeVibium && allServers.vibium) {
    selectedNames.push("vibium");
  }

  const uniqueNames = [...new Set(selectedNames)];
  const selected: Record<string, Record<string, unknown>> = {};

  for (const name of uniqueNames) {
    if (allServers[name]) {
      selected[name] = allServers[name];
    }
  }

  return selected;
};

export const loadWorkflowPrompt = async (
  workflowType: keyof typeof promptPathByWorkflow
): Promise<{ sourcePath: string; prompt: string }> => {
  const sourcePath = path.join(workspaceRoot, promptPathByWorkflow[workflowType]);
  const prompt = await readFile(sourcePath, "utf8");
  return { sourcePath, prompt };
};

export const runCopilotWorkflow = async (options: {
  workflowType: keyof typeof promptPathByWorkflow;
  userInput: string;
}): Promise<{ engine: "copilot-sdk"; summary: string; responsePreview: string; responseFull: string }> => {
  console.log(
    JSON.stringify({
      level: "info",
      scope: "copilot-orchestrator",
      action: "start",
      workflowType: options.workflowType
    })
  );
  const loaded = await loadWorkflowPrompt(options.workflowType);
  const model = process.env.COPILOT_MODEL || "gpt-5";
  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS || 180000);
  const combinedPrompt = [
    "Follow this workflow contract exactly:",
    loaded.prompt,
    "",
    "Tooling policy: use only MCP tools exposed by configured MCP servers; no SDK local function tools are available.",
    "",
    "User workflow input:",
    options.userInput
  ].join("\n");

  const sdk = await import("@github/copilot-sdk");
  const CopilotClient = sdk.CopilotClient;
  const approveAll = sdk.approveAll;
  const cliUrl = process.env.COPILOT_CLI_URL;
  const configuredCliPath = resolveCliCommand();
  const useManagedServerMode = process.platform === "win32" && !cliUrl;
  const managedPort = Number(process.env.COPILOT_CLI_PORT || 4321);
  const managedCliUrl = useManagedServerMode
    ? await ensureManagedCliServer(configuredCliPath, managedPort)
    : undefined;

  console.log(
    JSON.stringify({
      level: "info",
      scope: "copilot-orchestrator",
      action: "runtime",
      workflowType: options.workflowType,
      model,
      timeoutMs,
      hasCliUrl: Boolean(cliUrl),
      managedCliUrl: managedCliUrl || null,
      useManagedServerMode
    })
  );

  const client = cliUrl
    ? new CopilotClient({
        cliUrl,
        logLevel: "error"
      })
    : managedCliUrl
    ? new CopilotClient({
        cliUrl: managedCliUrl,
        logLevel: "error"
      })
    : new CopilotClient({
        cliPath: configuredCliPath,
        useLoggedInUser: true,
        logLevel: "error"
      });

  let responsePreview = "";
  let responseFull = "";

  try {
    await client.start();
    console.log(
      JSON.stringify({
        level: "info",
        scope: "copilot-orchestrator",
        action: "client_started",
        workflowType: options.workflowType
      })
    );

    const authStatus = await client.getAuthStatus();
    if (!authStatus.isAuthenticated) {
      throw new Error(
        "Copilot SDK is not authenticated. Run `copilot auth login` (or configure token/BYOK) and retry."
      );
    }
    console.log(
      JSON.stringify({
        level: "info",
        scope: "copilot-orchestrator",
        action: "authenticated",
        workflowType: options.workflowType
      })
    );

    const mcpLoaded = await loadMcpServersForWorkflow(options.workflowType);
    const selectedMcpServers = selectMcpServersForWorkflow(options.workflowType, mcpLoaded.mcpServers);
    console.log(
      JSON.stringify({
        level: "info",
        scope: "copilot-orchestrator",
        action: "mcp_config_loaded",
        workflowType: options.workflowType,
        configPath: mcpLoaded.configPath,
        serverNames: Object.keys(mcpLoaded.mcpServers),
        requiredServerNames: requiredMcpServerNamesByWorkflow[options.workflowType],
        selectedServerNames: Object.keys(selectedMcpServers),
        includeVibiumMcp: process.env.COPILOT_ENABLE_VIBIUM_MCP === "true"
      })
    );

    const session = await client.createSession({
      model,
      workingDirectory: workspaceRoot,
      streaming: true,
      onPermissionRequest: approveAll,
      mcpServers: selectedMcpServers as Record<string, any>
    });
    console.log(
      JSON.stringify({
        level: "info",
        scope: "copilot-orchestrator",
        action: "session_created",
        workflowType: options.workflowType
      })
    );

    const streamed: string[] = [];
    session.on("assistant.message_delta", (event) => {
      if (typeof event.data.deltaContent === "string" && event.data.deltaContent.length > 0) {
        streamed.push(event.data.deltaContent);
      }
    });

    const finalEvent = await session.sendAndWait(
      {
        prompt: combinedPrompt,
        mode: "immediate"
      },
      timeoutMs
    );

    console.log(
      JSON.stringify({
        level: "info",
        scope: "copilot-orchestrator",
        action: "session_completed",
        workflowType: options.workflowType
      })
    );

    const finalContent = finalEvent?.data.content || streamed.join("");
    responseFull = finalContent;
    responsePreview = finalContent.slice(0, 1200);

    await session.destroy();
    console.log(
      JSON.stringify({
        level: "info",
        scope: "copilot-orchestrator",
        action: "session_destroyed",
        workflowType: options.workflowType
      })
    );

    return {
      engine: "copilot-sdk",
      summary: `Executed ${options.workflowType} with Copilot SDK using model ${model}.`,
      responsePreview,
      responseFull
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        scope: "copilot-orchestrator",
        action: "failed",
        workflowType: options.workflowType,
        error: message
      })
    );
    if (message.includes("Copilot CLI not found")) {
      throw new Error(
        "Copilot CLI could not be launched from the SDK process. " +
          "Ensure `copilot --version` works in this shell, set COPILOT_CLI_PATH to a valid command, " +
          "or run an external CLI server and set COPILOT_CLI_URL (e.g. localhost:4321)."
      );
    }
    if (message.includes("ERR_UNKNOWN_BUILTIN_MODULE") && message.includes("node:sqlite")) {
      throw new Error(
        "Copilot CLI runtime is incompatible with bundled SDK CLI on this Node version. " +
          "Set COPILOT_CLI_PATH=copilot and ensure `copilot --version` works in PATH, " +
          "or upgrade Node/Copilot CLI to a compatible version."
      );
    }
    throw error;
  } finally {
    await client.stop();
    console.log(
      JSON.stringify({
        level: "info",
        scope: "copilot-orchestrator",
        action: "client_stopped",
        workflowType: options.workflowType
      })
    );
  }
};