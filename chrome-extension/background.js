/**
 * Chrome 扩展后台脚本
 * 负责协调 Side Panel 和 Content Script 之间的通信
 */

// 监听扩展图标点击事件，打开 Side Panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 监听来自 Side Panel 和 Content Script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  switch (message.type) {
    case 'START_SELECTION':
      // Side Panel 请求开始选取
      handleStartSelection(sender.tab?.id);
      sendResponse({ success: true });
      break;

    case 'CONTENT_SELECTED':
      // Content Script 发送选中的内容
      handleContentSelected(message.data);
      sendResponse({ success: true });
      break;

    case 'CANCEL_SELECTION':
      // 取消选取
      handleCancelSelection(sender.tab?.id);
      sendResponse({ success: true });
      break;

    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // 保持消息通道开启
});

/**
 * 处理开始选取请求
 */
async function handleStartSelection(tabId) {
  if (!tabId) {
    console.error('No tab ID provided');
    return;
  }

  try {
    // 向 Content Script 发送开始选取的消息
    await chrome.tabs.sendMessage(tabId, {
      type: 'START_SELECTION'
    });
    console.log('Selection mode activated in tab', tabId);
  } catch (error) {
    console.error('Failed to activate selection mode:', error);
  }
}

/**
 * 处理取消选取请求
 */
async function handleCancelSelection(tabId) {
  if (!tabId) {
    console.error('No tab ID provided');
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'CANCEL_SELECTION'
    });
    console.log('Selection mode cancelled in tab', tabId);
  } catch (error) {
    console.error('Failed to cancel selection mode:', error);
  }
}

/**
 * 处理选中的内容
 */
async function handleContentSelected(data) {
  console.log('Content selected:', data);

  try {
    // 构建 VSCode URI
    const params = {
      html: data.html,
      title: data.title,
      url: data.url
    };

    // 方案一：使用 VSCode URI Handler
    // const vscodeUri = `vscode://wedaren.issue-manager/create-from-html?data=${encodeURIComponent(JSON.stringify(params))}`;
    
    // 方案二：发送到本地服务器 (更可靠)
    const response = await fetch('http://localhost:37892/create-note', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });

    if (response.ok) {
      console.log('Note created successfully in VSCode');
      // 通知 Side Panel 创建成功
      notifySidePanel({ type: 'CREATION_SUCCESS' });
    } else {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send content to VSCode:', error);
    
    // 如果 HTTP 请求失败，尝试使用 URI Handler 作为备选方案
    try {
      const params = {
        html: data.html,
        title: data.title,
        url: data.url
      };
      const vscodeUri = `vscode://wedaren.issue-manager/create-from-html?data=${encodeURIComponent(JSON.stringify(params))}`;
      
      // 使用 chrome.tabs.create 打开 URI
      chrome.tabs.create({ url: vscodeUri, active: false }, (tab) => {
        // 创建后立即关闭标签页
        if (tab.id) {
          setTimeout(() => chrome.tabs.remove(tab.id), 100);
        }
      });
      
      notifySidePanel({ type: 'CREATION_SUCCESS' });
    } catch (fallbackError) {
      console.error('Fallback method also failed:', fallbackError);
      notifySidePanel({ 
        type: 'CREATION_ERROR', 
        error: '无法连接到 VSCode，请确保 VSCode 已打开且 Issue Manager 扩展已启用。' 
      });
    }
  }
}

/**
 * 通知 Side Panel
 */
async function notifySidePanel(message) {
  try {
    // 获取所有打开的 Side Panel 视图并发送消息
    const views = chrome.extension.getViews({ type: 'popup' });
    views.forEach(view => {
      if (view.postMessage) {
        view.postMessage(message, '*');
      }
    });
  } catch (error) {
    console.error('Failed to notify side panel:', error);
  }
}
