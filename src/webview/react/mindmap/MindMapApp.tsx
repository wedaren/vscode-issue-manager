import React from 'react';
import type {
  MindMapFromWebviewMessage,
  MindMapToWebviewMessage,
  MindMapNode,
} from '../../webviewTypes';
import { useVsCodeMessages } from '../common/useVsCodeMessages';

declare global {
  interface Window {
    __INITIAL_STATE__?: {
      mindMapData?: MindMapNode;
    };
  }
}

export const MindMapApp = () => {
  const [data, setData] = React.useState(
    () => window.__INITIAL_STATE__?.mindMapData,
  );

  const { postMessage } = useVsCodeMessages<MindMapToWebviewMessage, MindMapFromWebviewMessage>(
    (message) => {
      switch (message.type) {
        case 'updateData':
          setData(message.data);
          break;
        default:
          break;
      }
    },
  );

  React.useEffect(() => {
    postMessage({ type: 'ready' });
  }, [postMessage]);

  const hasData = !!data as boolean;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <header
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--vscode-panel-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 500 }}>思维导图（React 版 Beta）</span>
      </header>

      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
        }}
      >
        {!hasData && (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--vscode-descriptionForeground)',
              fontSize: 14,
            }}
          >
            正在等待思维导图数据...
          </div>
        )}

        {hasData && data && (
          <MindMapTreeView
            root={data}
            onOpenFile={(filePath: string) =>
              postMessage({
                type: 'openFile',
                filePath,
              })
            }
          />
        )}
      </main>
    </div>
  );
};

interface MindMapTreeViewProps {
  root: MindMapNode;
  onOpenFile: (filePath: string) => void;
}

const MindMapTreeView = ({ root, onOpenFile }: MindMapTreeViewProps) => {
  return (
    <div>
      <TreeNode node={root} depth={0} onOpenFile={onOpenFile} />
    </div>
  );
};

interface TreeNodeProps {
  node: MindMapNode;
  depth: number;
  onOpenFile: (filePath: string) => void;
  key?: string;
}

const TreeNode = ({ node, depth, onOpenFile }: TreeNodeProps) => {
  const hasChildren = !!node.children && node.children.length > 0;
  const canOpen = !!node.filePath && !node.hasError;

  const color = node.hasError
    ? 'var(--vscode-errorForeground)'
    : depth === 0
      ? 'var(--vscode-button-foreground)'
      : 'var(--vscode-editor-foreground)';

  const background = depth === 0 ? 'var(--vscode-button-background)' : 'transparent';

  const borderColor = node.hasError
    ? 'var(--vscode-inputValidation-errorBorder)'
    : depth === 0
      ? 'var(--vscode-button-border)'
      : 'var(--vscode-input-border)';

  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 6 }}>
      <div
        style={{
          padding: '4px 8px',
          borderRadius: 4,
          border: `1px solid ${borderColor}`,
          background,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: canOpen ? 'pointer' : 'default',
          color,
          fontWeight: depth === 0 ? 600 : 400,
        }}
        onClick={() => {
          if (canOpen && node.filePath) {
            onOpenFile(node.filePath);
          }
        }}
        title={node.errorMessage || node.filePath}
      >
        {hasChildren && (
          <span
            style={{
              fontSize: 10,
              opacity: 0.7,
            }}
          >
            {node.children?.length}
          </span>
        )}
        <span>{node.title || node.id}</span>
        {node.hasError && (
          <span
            style={{
              fontSize: 10,
              opacity: 0.8,
            }}
          >
            (错误)
          </span>
        )}
      </div>

      {hasChildren && (
        <div style={{ marginTop: 4 }}>
          {node.children!.map((child) => {
            const key = child.id;
            return (
              <TreeNode
                // React key
                // eslint-disable-next-line react/jsx-key
                key={key as any}
                node={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

 