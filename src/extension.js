'use strict';

const vscode = require('vscode');
const path = require('path');
const { generate } = require('./generator');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterJsonModel.open', (uri) => openPanel(context, uri)),
    vscode.commands.registerCommand('flutterJsonModel.fromClipboard', (uri) => fromClipboard(uri)),
  );
}

function getOptions() {
  const cfg = vscode.workspace.getConfiguration('flutterJsonModel');
  return {
    nullable: cfg.get('nullableFields', true),
    copyWith: cfg.get('copyWith', true),
    toString: cfg.get('toString', false),
  };
}

/** Pick the target folder: explorer selection > lib/models > workspace root > ask. */
async function resolveFolder(uri) {
  if (uri && uri.fsPath) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.type === vscode.FileType.Directory ? uri : vscode.Uri.file(path.dirname(uri.fsPath));
    } catch (_) { /* fall through */ }
  }
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (ws) {
    const sub = vscode.workspace.getConfiguration('flutterJsonModel').get('defaultFolder', 'lib/models');
    return vscode.Uri.joinPath(ws.uri, sub);
  }
  const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Save model here' });
  return picked && picked[0];
}

async function writeModel(folder, fileName, code) {
  await vscode.workspace.fs.createDirectory(folder);
  const target = vscode.Uri.joinPath(folder, fileName);
  let exists = false;
  try { await vscode.workspace.fs.stat(target); exists = true; } catch (_) { /* new file */ }
  if (exists) {
    const ans = await vscode.window.showWarningMessage(`${fileName} already exists. Overwrite?`, { modal: true }, 'Overwrite');
    if (ans !== 'Overwrite') return undefined;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(code, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc, { preview: false });
  try { await vscode.commands.executeCommand('editor.action.formatDocument'); } catch (_) { /* no Dart formatter */ }
  return target;
}

async function fromClipboard(uri) {
  const json = await vscode.env.clipboard.readText();
  if (!json.trim()) return vscode.window.showErrorMessage('Clipboard is empty — copy the JSON response first.');
  const className = await vscode.window.showInputBox({ prompt: 'Model class name', placeHolder: 'UserModel', value: 'Model' });
  if (!className) return;
  try {
    const { code, fileName } = generate(json, className, getOptions());
    const folder = await resolveFolder(uri);
    if (!folder) return;
    const saved = await writeModel(folder, fileName, code);
    if (saved) vscode.window.showInformationMessage(`Created ${vscode.workspace.asRelativePath(saved)}`);
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
  }
}

let panel;

function openPanel(context, uri) {
  if (panel) {
    panel.reveal();
    panel._targetUri = uri;
    return;
  }
  panel = vscode.window.createWebviewPanel('flutterJsonModel', 'JSON → Dart Model', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel._targetUri = uri;
  panel.webview.html = getHtml(panel.webview, getOptions());
  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);

  panel.webview.onDidReceiveMessage(async (msg) => {
    const opts = { nullable: !!msg.nullable, copyWith: !!msg.copyWith, toString: !!msg.toString };
    if (msg.type === 'preview') {
      try {
        const r = generate(msg.json, msg.className, opts);
        panel.webview.postMessage({ type: 'preview', code: r.code, fileName: r.fileName });
      } catch (e) {
        panel.webview.postMessage({ type: 'error', message: e.message });
      }
    } else if (msg.type === 'save') {
      try {
        const r = generate(msg.json, msg.className, opts);
        const folder = await resolveFolder(panel._targetUri);
        if (!folder) return;
        const saved = await writeModel(folder, r.fileName, r.code);
        if (saved) vscode.window.showInformationMessage(`Created ${vscode.workspace.asRelativePath(saved)}`);
      } catch (e) {
        vscode.window.showErrorMessage(e.message);
      }
    } else if (msg.type === 'copy') {
      await vscode.env.clipboard.writeText(msg.code || '');
      vscode.window.showInformationMessage('Dart model copied to clipboard');
    }
  });
}

function getHtml(webview, opts) {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const chk = (b) => (b ? 'checked' : '');
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; margin: 0; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
  input[type=text] { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); padding: 5px 8px; min-width: 200px; }
  label { display: flex; gap: 4px; align-items: center; user-select: none; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none;
    padding: 6px 14px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; height: calc(100vh - 110px); }
  @media (max-width: 800px) { .cols { grid-template-columns: 1fr; height: auto; } textarea, pre { min-height: 300px; } }
  textarea, pre { width: 100%; height: 100%; box-sizing: border-box; margin: 0; resize: none;
    font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
    background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-panel-border); padding: 8px; overflow: auto; }
  #status { font-size: 12px; opacity: .8; min-height: 16px; margin-bottom: 6px; }
  #status.err { color: var(--vscode-errorForeground); opacity: 1; }
</style>
</head>
<body>
  <div class="bar">
    <input id="cls" type="text" placeholder="Class name e.g. UserModel" value="Model">
    <label><input id="nullable" type="checkbox" ${chk(opts.nullable)}> Nullable</label>
    <label><input id="copyWith" type="checkbox" ${chk(opts.copyWith)}> copyWith</label>
    <label><input id="toString" type="checkbox" ${chk(opts.toString)}> toString</label>
    <button id="save">Create file</button>
    <button id="copy" class="secondary">Copy code</button>
  </div>
  <div id="status">Paste the API response (JSON) on the left.</div>
  <div class="cols">
    <textarea id="json" spellcheck="false" placeholder='{ "id": 1, "name": "Ali", "items": [ { "title": "x" } ] }'></textarea>
    <pre id="out"></pre>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const state = vscode.getState() || {};
  if (state.json) $('json').value = state.json;
  if (state.cls) $('cls').value = state.cls;

  function payload(type) {
    return { type, json: $('json').value, className: $('cls').value,
      nullable: $('nullable').checked, copyWith: $('copyWith').checked, toString: $('toString').checked };
  }
  let t;
  function refresh() {
    vscode.setState({ json: $('json').value, cls: $('cls').value });
    clearTimeout(t);
    if (!$('json').value.trim()) { $('out').textContent = ''; setStatus('Paste the API response (JSON) on the left.'); return; }
    t = setTimeout(() => vscode.postMessage(payload('preview')), 200);
  }
  function setStatus(text, err) { $('status').textContent = text; $('status').className = err ? 'err' : ''; }

  ['json', 'cls'].forEach((id) => $(id).addEventListener('input', refresh));
  ['nullable', 'copyWith', 'toString'].forEach((id) => $(id).addEventListener('change', refresh));
  $('save').addEventListener('click', () => vscode.postMessage(payload('save')));
  $('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy', code: $('out').textContent }));

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'preview') { $('out').textContent = m.code; setStatus('File: ' + m.fileName); }
    else if (m.type === 'error') setStatus(m.message, true);
  });
  $('json').focus();
  refresh();
</script>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
