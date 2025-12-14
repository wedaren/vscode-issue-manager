import * as vscode from 'vscode';

class CopilotDocumentProvider implements vscode.TextDocumentContentProvider {
    private docs = new Map<string, string>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.docs.get(uri.toString()) || '';
    }

    setContent(uri: vscode.Uri, content: string) {
        this.docs.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    clear(uri: vscode.Uri) {
        this.docs.delete(uri.toString());
        this._onDidChange.fire(uri);
    }
}

export const copilotDocumentProvider = new CopilotDocumentProvider();

export default CopilotDocumentProvider;
