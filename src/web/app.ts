import { createClient } from "@rivet-dev/agentos/client";
import { Effect } from "effect";
import type { registry } from "../agentos/index.ts";
import type { Timeouts } from "../config/index.ts";
import { connectWorkspace, type Workspace, type WorkspaceSession, type WorkspaceHistory } from "../workspace/index.ts";

type Vm = ReturnType<ReturnType<ReturnType<typeof createClient<typeof registry>>["vm"]["getOrCreate"]>["connect"]>;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sessionsElement = byId<HTMLElement>("sessions");
const messagesElement = byId<HTMLElement>("messages");
const conversation = byId<HTMLElement>("conversation");
const welcome = byId<HTMLElement>("welcome");
const promptInput = byId<HTMLTextAreaElement>("prompt");
const sendButton = byId<HTMLButtonElement>("send");
const connectDialog = byId<HTMLDialogElement>("connect-dialog");
const sessionDialog = byId<HTMLDialogElement>("session-dialog");
const deleteDialog = byId<HTMLDialogElement>("delete-dialog");
const connectError = byId<HTMLElement>("connect-error");
const sessionError = byId<HTMLElement>("session-error");
const fileTree = byId<HTMLElement>("file-tree");
const maxFilePreviewBytes = 1_000_000;
const boundedReadScript = `
const fs = require("node:fs");
const limit = Number(process.argv[1]);
const path = process.argv[2];
const handle = fs.openSync(path, "r");
try {
  const bytes = Buffer.alloc(limit + 1);
  const length = fs.readSync(handle, bytes, 0, bytes.length, 0);
  if (length > limit) process.exitCode = 3;
  else process.stdout.write(bytes.subarray(0, length));
} finally {
  fs.closeSync(handle);
}
`;

let vm: Vm | undefined;
let workspace: Workspace | undefined;
let sessions: WorkspaceSession[] = [];
let activeSessionId: string | undefined;
let busy = false;
let generation = 0;
let previewRequest = 0;

const storedEndpoint = localStorage.getItem("egeria.agentos.endpoint");
const storedVmId = localStorage.getItem("egeria.agentos.vmId");

function setRuntimeState(state: "offline" | "connecting" | "online", detail: string) {
  byId("status-dot").className = `status-dot ${state}`;
  byId("runtime-state").textContent = state === "online" ? "Sandbox online" : state === "connecting" ? "Connecting…" : "Disconnected";
  byId("runtime-detail").textContent = detail;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function closeMobileMenu() {
  document.body.classList.remove("menu-open");
  byId<HTMLButtonElement>("mobile-menu").setAttribute("aria-expanded", "false");
}

function resetTerminal() {
  const output = byId("terminal-output");
  output.replaceChildren();
  const hint = document.createElement("span");
  hint.className = "terminal-muted";
  hint.textContent = "Commands run inside /workspace.";
  output.append(hint);
}

function clearFiles() {
  previewRequest += 1;
  fileTree.replaceChildren();
  byId("file-preview").hidden = true;
  byId("file-name").textContent = "";
  byId("file-content").textContent = "";
}

function addMessage(role: "user" | "agent" | "system", text: string) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "agent" ? "EGERIA · PI" : role.toUpperCase();
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;
  article.append(label, body);
  messagesElement.append(article);
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}

function renderSessions() {
  sessionsElement.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-side";
    empty.textContent = "No sessions yet. Create one to wake an agent.";
    sessionsElement.append(empty);
    return;
  }

  for (const session of sessions) {
    const row = document.createElement("div");
    row.className = "session-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-item${session.sessionId === activeSessionId ? " active" : ""}`;
    const status = session.status === "running" ? "working" : session.status;
    button.innerHTML = `<span class="session-icon">◇</span><span><strong></strong><small></small></span>`;
    button.querySelector("strong")!.textContent = session.sessionId;
    button.querySelector("small")!.textContent = `${status} · ${new Date(session.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}`;
    button.addEventListener("click", () => {
      closeMobileMenu();
      void selectSession(session.sessionId);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-session";
    remove.title = `Delete ${session.sessionId}`;
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      byId("delete-session-name").textContent = session.sessionId;
      deleteDialog.dataset.sessionId = session.sessionId;
      deleteDialog.showModal();
    });
    row.append(button, remove);
    sessionsElement.append(row);
  }
}

async function loadHistory() {
  if (!vm || !workspace || !activeSessionId) return;
  const selectedVm = vm;
  const selectedSessionId = activeSessionId;
  const selectedGeneration = generation;
  let history: WorkspaceHistory;
  try {
    history = await Effect.runPromise(workspace.history(selectedSessionId));
  } catch (error) {
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    messagesElement.replaceChildren();
    addMessage("system", `Could not load this session's history: ${errorText(error)}`);
    return;
  }
  if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
  messagesElement.replaceChildren();
  if (history.truncated) addMessage("system", "Older session history is omitted.");
  for (const message of history.messages) addMessage(message.role, message.text);
  if (history.failure) addMessage("system", history.failure);
  if (history.status === "running") addMessage("system", "pi-durable is working inside the sandbox…");
  sendButton.disabled = history.status === "running";
  welcome.hidden = messagesElement.childElementCount > 0;
  return history;
}

async function followHistory() {
  const selectedGeneration = generation;
  do {
    const history = await loadHistory();
    if (generation !== selectedGeneration || !history) return;
    if (history.status !== "running") {
      await Promise.all([refreshSessions(), refreshFiles()]);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (generation === selectedGeneration);
}

async function selectSession(sessionId: string) {
  generation += 1;
  activeSessionId = sessionId;
  const session = sessions.find((item) => item.sessionId === sessionId);
  byId("session-title").textContent = session?.sessionId || sessionId;
  renderSessions();
  messagesElement.replaceChildren();
  addMessage("system", "Loading session history…");
  resetTerminal();
  clearFiles();
  promptInput.disabled = false;
  sendButton.disabled = false;
  byId<HTMLInputElement>("terminal-command").disabled = false;
  void followHistory();
  await refreshFiles();
  promptInput.focus();
}

async function refreshSessions(selectNewest = false) {
  if (!vm || !workspace) return;
  const selectedVm = vm;
  const selectedGeneration = generation;
  const allSessions = await Effect.runPromise(workspace.listSessions());
  if (vm !== selectedVm || generation !== selectedGeneration) return;
  sessions = allSessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  renderSessions();
  if (selectNewest && sessions[0]) await selectSession(sessions[0].sessionId);
}

async function connect(endpoint: string, vmId: string) {
  const endpointUrl = new URL(endpoint);
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const isLoopback = loopback.has(endpointUrl.hostname);
  if (endpointUrl.protocol !== "https:" && !(endpointUrl.protocol === "http:" && isLoopback)) {
    throw new Error("Remote agentOS endpoints must use authenticated HTTPS");
  }
  if (endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) {
    throw new Error("Actor endpoints cannot contain credentials, query strings, or fragments");
  }
  setRuntimeState("connecting", vmId);
  const client = createClient<typeof registry>({ endpoint });
  const token = byId<HTMLInputElement>("auth-token").value;
  if (!isLoopback && !token) throw new Error("Remote agentOS endpoints require a connection capability");
  // Persistent RPC avoids streaming HTTP uploads unsupported by browsers over HTTP/1.1.
  const candidate = client.vm.getOrCreate(vmId).connect(token ? { token } : {});
  let candidateWorkspace: Workspace;
  try {
    await candidate.listAgents();
    const bundle = await fetch("/egeria-durable.cjs");
    if (!bundle.ok) throw new Error("Could not load the pi-durable workspace service");
    const runtimeConfig = await fetch("/runtime-config");
    if (!runtimeConfig.ok) throw new Error("Could not load the workspace timeout configuration");
    const { timeouts } = await runtimeConfig.json() as { timeouts: Timeouts };
    candidateWorkspace = await Effect.runPromise(connectWorkspace(candidate, await bundle.text(), timeouts));
  } catch (error) {
    await candidate.dispose();
    throw error;
  }
  byId<HTMLInputElement>("auth-token").value = "";
  generation += 1;
  await vm?.dispose();
  vm = candidate;
  workspace = candidateWorkspace;
  activeSessionId = undefined;
  sessions = [];
  messagesElement.replaceChildren();
  resetTerminal();
  clearFiles();
  welcome.hidden = false;
  byId("session-title").textContent = "New workspace";
  promptInput.disabled = true;
  sendButton.disabled = true;
  byId<HTMLInputElement>("terminal-command").disabled = true;
  localStorage.setItem("egeria.agentos.endpoint", endpoint);
  localStorage.setItem("egeria.agentos.vmId", vmId);
  byId<HTMLInputElement>("endpoint").value = endpoint;
  byId<HTMLInputElement>("vm-id").value = vmId;
  setRuntimeState("online", vmId);
  await refreshSessions(true);
}

async function createSession(sessionId: string, accountId: string, gatewayId: string, apiKey: string) {
  if (!vm || !workspace) throw new Error("Connect to agentOS first");
  if (sessions.some((session) => session.sessionId === sessionId)) throw new Error("A session with this name already exists");

  const selectedVm = vm;
  const selectedGeneration = generation;
  await Effect.runPromise(workspace.createSession({ sessionId, accountId, gatewayId, apiKey }));
  if (vm !== selectedVm || generation !== selectedGeneration) return;
  await refreshSessions();
  await selectSession(sessionId);
}

async function sendPrompt(text: string) {
  if (!vm || !workspace || !activeSessionId || busy || !text.trim()) return;
  busy = true;
  const selectedVm = vm;
  const selectedSessionId = activeSessionId;
  const selectedGeneration = generation;
  promptInput.value = "";
  promptInput.style.height = "auto";
  welcome.hidden = true;
  addMessage("user", text.trim());
  const pending = addMessage("system", "Agent is working inside the sandbox…");
  sendButton.disabled = true;
  try {
    await Effect.runPromise(workspace.submit(selectedSessionId, text.trim(), crypto.randomUUID()));
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    pending.remove();
    await followHistory();
  } catch (error) {
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    pending.remove();
    addMessage("system", `The agent could not finish: ${errorText(error)}`);
  } finally {
    busy = false;
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    sendButton.disabled = false;
    promptInput.focus();
  }
}

async function refreshFiles() {
  if (!vm) return;
  const selectedVm = vm;
  const selectedSessionId = activeSessionId;
  const selectedGeneration = generation;
  try {
    const entries = await selectedVm.readdirRecursive("/workspace", { maxDepth: 5, exclude: ["node_modules", ".git"] });
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    fileTree.replaceChildren();
    const files = entries.filter((entry) => entry.type === "file").sort((a, b) => a.path.localeCompare(b.path));
    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "panel-empty";
      empty.textContent = "The workspace is empty.";
      fileTree.append(empty);
      return;
    }
    for (const file of files) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-item";
      button.innerHTML = `<span>·</span><span></span>`;
      button.lastElementChild!.textContent = file.path.replace(/^\/workspace\//, "");
      button.addEventListener("click", () => void openFile(file.path));
      fileTree.append(button);
    }
  } catch (error) {
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    fileTree.textContent = errorText(error);
  }
}

async function openFile(path: string) {
  if (!vm) return;
  const selectedVm = vm;
  const selectedSessionId = activeSessionId;
  const selectedGeneration = generation;
  const selectedPreviewRequest = ++previewRequest;
  const preview = byId("file-preview");
  const content = byId("file-content");
  byId("file-name").textContent = path.replace(/^\/workspace\//, "");
  content.textContent = "Loading preview…";
  preview.hidden = false;
  try {
    const stat = await selectedVm.stat(path);
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration || previewRequest !== selectedPreviewRequest) return;
    if (stat.size > maxFilePreviewBytes) {
      content.textContent = `This file is too large to preview (${stat.size.toLocaleString()} bytes; limit ${maxFilePreviewBytes.toLocaleString()} bytes).`;
      return;
    }
    const result = await selectedVm.execArgv(
      "node",
      ["-e", boundedReadScript, String(maxFilePreviewBytes), path],
      { timeout: 10_000 },
    );
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration || previewRequest !== selectedPreviewRequest) return;
    if (result.exitCode === 3) {
      content.textContent = `This file grew beyond the ${maxFilePreviewBytes.toLocaleString()} byte preview limit.`;
      return;
    }
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Preview reader exited with status ${result.exitCode}`);
    }
    if (result.stdout.includes("\0")) {
      content.textContent = "Binary files cannot be previewed.";
      return;
    }
    content.textContent = result.stdout;
  } catch (error) {
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration || previewRequest !== selectedPreviewRequest) return;
    content.textContent = `Could not preview this file: ${errorText(error)}`;
  }
}

byId<HTMLFormElement>("connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value === "cancel") return connectDialog.close();
  connectError.textContent = "";
  const button = byId<HTMLButtonElement>("connect-button");
  button.disabled = true;
  try {
    await connect(byId<HTMLInputElement>("endpoint").value.trim().replace(/\/$/, ""), byId<HTMLInputElement>("vm-id").value.trim());
    connectDialog.close();
  } catch (error) {
    setRuntimeState("offline", "agentOS runtime");
    connectError.textContent = errorText(error);
  } finally {
    button.disabled = false;
  }
});

byId<HTMLFormElement>("session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value === "cancel") return sessionDialog.close();
  sessionError.textContent = "";
  const button = byId<HTMLButtonElement>("create-session-button");
  const apiKeyInput = byId<HTMLInputElement>("api-key");
  const apiKey = apiKeyInput.value;
  apiKeyInput.value = "";
  button.disabled = true;
  try {
    await createSession(
      byId<HTMLInputElement>("session-name").value.trim(),
      byId<HTMLInputElement>("account-id").value.trim(),
      byId<HTMLInputElement>("gateway-id").value.trim(),
      apiKey,
    );
    sessionDialog.close();
  } catch (error) {
    sessionError.textContent = errorText(error);
  } finally {
    button.disabled = false;
  }
});

byId<HTMLFormElement>("delete-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value === "cancel") return deleteDialog.close();
  const sessionId = deleteDialog.dataset.sessionId;
  if (!vm || !workspace || !sessionId) return;
  const selectedVm = vm;
  const selectedGeneration = generation;
  const button = byId<HTMLButtonElement>("delete-session-button");
  byId("delete-error").textContent = "";
  button.disabled = true;
  try {
    await Effect.runPromise(workspace.deleteSession(sessionId));
    if (vm !== selectedVm || generation !== selectedGeneration) return;
    if (activeSessionId === sessionId) {
      generation += 1;
      activeSessionId = undefined;
      messagesElement.replaceChildren();
      clearFiles();
      welcome.hidden = false;
      byId("session-title").textContent = "New workspace";
      promptInput.disabled = true;
      sendButton.disabled = true;
    }
    await refreshSessions(true);
    deleteDialog.close();
  } catch (error) {
    byId("delete-error").textContent = errorText(error);
  } finally {
    button.disabled = false;
  }
});

byId<HTMLFormElement>("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  void sendPrompt(promptInput.value);
});
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    byId<HTMLFormElement>("composer").requestSubmit();
  }
});
promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
});

byId("new-session").addEventListener("click", () => {
  closeMobileMenu();
  vm ? sessionDialog.showModal() : connectDialog.showModal();
});
byId("runtime-settings").addEventListener("click", () => {
  closeMobileMenu();
  connectDialog.showModal();
});
byId("mobile-menu").addEventListener("click", () => {
  const open = document.body.classList.toggle("menu-open");
  byId<HTMLButtonElement>("mobile-menu").setAttribute("aria-expanded", String(open));
});
byId("mobile-scrim").addEventListener("click", closeMobileMenu);
byId("refresh").addEventListener("click", () => void Promise.all([refreshSessions(), refreshFiles()]));
byId("refresh-files").addEventListener("click", () => void refreshFiles());
byId("close-file").addEventListener("click", () => {
  previewRequest += 1;
  byId("file-preview").hidden = true;
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-prompt]")) {
  button.addEventListener("click", () => void sendPrompt(button.dataset.prompt ?? ""));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".inspector .panel").forEach((panel) => panel.classList.remove("active"));
    byId(`${button.dataset.tab}-panel`).classList.add("active");
  });
}

byId<HTMLFormElement>("terminal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!vm) return;
  const selectedVm = vm;
  const selectedSessionId = activeSessionId;
  const selectedGeneration = generation;
  const input = byId<HTMLInputElement>("terminal-command");
  const command = input.value.trim();
  if (!command) return;
  input.value = "";
  const output = byId("terminal-output");
  const block = document.createElement("pre");
  block.textContent = `$ ${command}\n`;
  output.append(block);
  try {
    const result = await selectedVm.exec(command, { cwd: "/workspace", timeout: 30_000 });
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    block.textContent += `${result.stdout}${result.stderr}${result.exitCode ? `\n[exit ${result.exitCode}]` : ""}`;
    await refreshFiles();
  } catch (error) {
    if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
    block.textContent += errorText(error);
  }
  if (vm !== selectedVm || activeSessionId !== selectedSessionId || generation !== selectedGeneration) return;
  output.scrollTop = output.scrollHeight;
});

async function start() {
  let endpoint: string | null = null;
  let vmId: string | null = null;
  try {
    const response = await fetch("/runtime-config");
    const runtime = await response.json() as { agentOsEndpoint: string | null; vmId: string };
    endpoint = runtime.agentOsEndpoint ?? storedEndpoint;
    vmId = runtime.agentOsEndpoint ? runtime.vmId : (storedVmId ?? runtime.vmId);
  } catch {
    // The connection dialog remains the fallback.
  }
  endpoint ??= storedEndpoint;
  vmId ??= storedVmId;
  byId<HTMLInputElement>("endpoint").value = endpoint ?? "http://localhost:6420";
  byId<HTMLInputElement>("vm-id").value = vmId ?? "egeria-browser";
  if (endpoint && vmId) {
    try {
      await connect(endpoint, vmId);
      return;
    } catch {
      setRuntimeState("offline", "Connection needs attention");
    }
  }
  connectDialog.showModal();
}

void start();
