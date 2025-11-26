import React from 'react';
import ReactDOM from 'react-dom/client';
import { MindMapApp } from '../mindmap/MindMapApp';

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <MindMapApp />
    </React.StrictMode>,
  );
} else {
  // eslint-disable-next-line no-console
  console.error('[MindMap] Root element #root not found');
}


