<template>
  <div class="tree-node">
    <!-- 节点标题头部 -->
    <div 
      class="tree-node-header-compact"
      :class="{ expanded: isExpanded }"
      @click="toggleExpand"
    >
      <!-- 展开/收起箭头 -->
      <span class="toggle-icon" :class="{ 'is-expanded': isExpanded }">
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="node-title">{{ nodeTitle }}</span>
      <!-- 生成标题按钮 -->
      <button
        class="generate-btn"
        title="AI 生成标题"
        @click.stop="handleGenerateTitle"
      >
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2l1.2 3.6L13 5l-3 2.3 1 3.7L8 9l-3 2 1-3.7L3 5l3.8.6L8 2z" fill="currentColor" opacity="0.85"/>
        </svg>
        <span>生成</span>
      </button>
    </div>

    <div v-if="statusMessage" class="node-status">{{ statusMessage }}</div>

    <!-- 节点内容详情 -->
    <div v-show="isExpanded" class="tree-node-content">
      <div v-if="node.content" class="markdown-body" v-html="parsedMarkdown"></div>
      <div v-else class="no-content">暂无内容</div>
    </div>

    <!-- 子节点 -->
    <div v-if="hasChildren && isExpanded" class="tree-node-children">
      <TreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        @update:node-content="onChildUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface TreeNode {
  id: string;
  title: string;
  filename: string;
  filePath?: string;
  absolutePath?: string;
  content?: string;
  mtime?: number;
  children?: TreeNode[];
}

interface TreeNodeProps {
  node: TreeNode;
  level: number;
}

const props = defineProps<TreeNodeProps>();
const emit = defineEmits<{
  (e: 'update:node-content', payload: { nodeId: string; content: string; mtime?: number }): void;
}>();

const isExpanded = ref(false);

const statusMessage = ref('');

let clearTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleClearMessage(delay = 3000) {
  if (clearTimer) {
    clearTimeout(clearTimer);
  }
  clearTimer = setTimeout(() => (statusMessage.value = ''), delay);
}

onUnmounted(() => {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
});

// 配置 marked 选项
marked.setOptions({
  breaks: true,        // 支持 GFM 换行
  gfm: true,          // 启用 GitHub Flavored Markdown
});

const nodeTitle = computed(() => {
  return props.node.title
});

const hasChildren = computed(() => {
  return props.node.children && props.node.children.length > 0;
});

const parsedMarkdown = computed(() => {
  if (!props.node.content) {
    return '';
  }
  const contentWithoutH1 = removeFirstH1Title(props.node.content);
  const contentWithoutFrontMatter = removeFrontMatter(contentWithoutH1);
  return parseMarkdown(contentWithoutFrontMatter);
});

async function toggleExpand() {
  const node = props.node;
  const filePath = node.filePath ?? node.filename ?? node.absolutePath ?? '';

  // 展开时如果还没有 content，则按需请求
  if (!isExpanded.value && !props.node.content) {
    statusMessage.value = '';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ISSUE_MARKDOWN', filePath });
      if (response && response.success && response.content) {
        // 通过事件将内容传回父组件，由父组件更新 node 数据（遵循单向数据流）
        emit('update:node-content', {
          nodeId: props.node.id,
          content: response.content,
          mtime: response.mtime,
        });
        statusMessage.value = '';
      } else {
        statusMessage.value = '加载内容失败: ' + (response?.error || '未知错误');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      statusMessage.value = '加载内容失败: ' + msg;
    }
    scheduleClearMessage(5000);
  }

  isExpanded.value = !isExpanded.value;
}

async function handleGenerateTitle() {
  statusMessage.value = '请求中...';

  // 尝试从 node 中获取路径字段
  const node = props.node;
  const filePath = node.filePath ?? node.filename ?? node.absolutePath ?? '';

  if (!filePath) {
    statusMessage.value = '无法获取文件路径';
    scheduleClearMessage();
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_TITLE',
      filePath,
      id: props.node.id
    });

    if (response && response.success) {
      statusMessage.value = '生成标题已触发，正在刷新...';
    } else {
      statusMessage.value = '生成标题失败: ' + (response?.error || '未知错误');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    statusMessage.value = '生成请求失败: ' + msg;
  }

  scheduleClearMessage();
}

function onChildUpdate(payload: { nodeId: string; content: string; mtime?: number }) {
  // 将子节点的更新事件向上转发（父组件或祖先组件可处理）
  emit('update:node-content', payload);
}

/**
 * 移除 Markdown 内容中的第一个 H1 标题
 * 避免与节点头部标题重复显示
 */
function removeFirstH1Title(markdown: string): string {
  return markdown.replace(/^#\s+.+$/m, '').trim();
}


function removeFrontMatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

/**
 * 安全地解析 Markdown 为 HTML
 * 使用 marked 进行解析，使用 DOMPurify 进行 XSS 防护
 */
function parseMarkdown(markdown: string): string {
  if (!markdown) {
    return '';
  }
  
  try {
    // 使用 marked 解析 Markdown
    const rawHtml = marked.parse(markdown, { async: false }) as string;
    
    // 使用 DOMPurify 净化 HTML,防止 XSS 攻击
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'br', 'strong', 'em', 'u', 's', 'del',
        'a', 'code', 'pre',
        'ul', 'ol', 'li',
        'blockquote',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr', 'div', 'span',
        'img', 'input', // 添加图片和复选框支持
      ],
      ALLOWED_ATTR: [
        'href', 'target', 'rel', 'class',
        'src', 'alt', 'title', 'width', 'height', // 图片属性
        'type', 'checked', 'disabled', // 复选框属性
        'align', // 表格对齐
      ],
      ALLOW_DATA_ATTR: false,
    });
    
    return cleanHtml;
  } catch (error: unknown) {
    console.error('Failed to parse markdown:', error);
    // 如果解析失败，返回原始文本（已转义）
    const textNode = document.createTextNode(markdown);
    const div = document.createElement('div');
    div.appendChild(textNode);
    return div.innerHTML;
  }
}
</script>

<style scoped>
/* ========== 变量 ========== */
.tree-node {
  --bg-card: #1c2130;
  --bg-hover: #242938;
  --bg-expanded: #1e2535;
  --border-subtle: #2a3040;
  --border-active: rgba(56, 139, 253, 0.4);
  --accent-blue: #388bfd;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #484f58;

  margin-bottom: 4px;
}

.tree-node-header-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  transition: all 0.18s ease;
  user-select: none;
}

.tree-node-header-compact:hover {
  background: var(--bg-hover);
  border-color: rgba(56, 139, 253, 0.3);
}

.tree-node-header-compact.expanded {
  background: var(--bg-expanded);
  border-color: var(--border-active);
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom-color: rgba(56, 139, 253, 0.15);
}

/* 展开箭头 */
.toggle-icon {
  display: flex;
  align-items: center;
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.2s ease, color 0.15s ease;
}

.toggle-icon svg {
  width: 14px;
  height: 14px;
}

.toggle-icon.is-expanded {
  transform: rotate(90deg);
  color: var(--accent-blue);
}

.tree-node-header-compact:hover .toggle-icon {
  color: var(--text-secondary);
}

.node-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* 生成标题按钮 */
.generate-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  font-family: inherit;
}

.generate-btn svg {
  width: 12px;
  height: 12px;
  color: #fbbf24;
}

.generate-btn:hover {
  background: var(--bg-hover);
  border-color: rgba(56, 139, 253, 0.4);
  color: var(--text-primary);
}

.node-status {
  margin: 4px 0 6px 12px;
  color: #60a5fa;
  font-size: 11px;
  opacity: 0.8;
}

.tree-node-content {
  background: var(--bg-card);
  border: 1px solid var(--border-active);
  border-top: none;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 4px;
}

.tree-node-children {
  margin-left: 18px;
  margin-top: 4px;
  padding-left: 10px;
  border-left: 2px solid rgba(56, 139, 253, 0.2);
}

.markdown-body {
  font-size: 14px;
  line-height: 1.8;
  color: #d4d4d4;
  word-wrap: break-word;
}

/* 使用深度选择器确保样式应用到 v-html 渲染的内容 */
.markdown-body :deep(> :first-child) {
  margin-top: 0;
}

.markdown-body :deep(> :last-child) {
  margin-bottom: 0;
}

/* 标题样式 - 使用深度选择器 */
.markdown-body :deep(h1) {
  font-size: 24px;
  font-weight: 600;
  margin: 20px 0 16px;
  color: #ffffff;
  border-bottom: 2px solid #3c3c3c;
  padding-bottom: 10px;
  line-height: 1.3;
}

.markdown-body :deep(h2) {
  font-size: 20px;
  font-weight: 600;
  margin: 18px 0 14px;
  color: #ffffff;
  border-bottom: 1px solid #3c3c3c;
  padding-bottom: 8px;
  line-height: 1.3;
}

.markdown-body :deep(h3) {
  font-size: 16px;
  font-weight: 600;
  margin: 16px 0 12px;
  color: #e8e8e8;
  line-height: 1.3;
}

.markdown-body :deep(h4) {
  font-size: 14px;
  font-weight: 600;
  margin: 14px 0 10px;
  color: #cccccc;
  line-height: 1.3;
}

.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 13px;
  font-weight: 600;
  margin: 12px 0 8px;
  color: #b4b4b4;
  line-height: 1.3;
}

/* 段落样式 */
.markdown-body :deep(p) {
  margin: 12px 0;
  line-height: 1.8;
}

/* 代码样式 */
.markdown-body :deep(code) {
  background: #1e1e1e;
  padding: 3px 8px;
  border-radius: 4px;
  font-family: 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  color: #ce9178;
  border: 1px solid #2d2d30;
}

.markdown-body :deep(pre) {
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  margin: 16px 0;
  line-height: 1.6;
}

.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
  color: #d4d4d4;
  border: none;
  font-size: 13px;
}

/* 列表样式 */
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 12px 0;
  padding-left: 28px;
  line-height: 1.8;
}

.markdown-body :deep(li) {
  margin: 6px 0;
}

.markdown-body :deep(li > p) {
  margin: 4px 0;
}

.markdown-body :deep(ul ul),
.markdown-body :deep(ol ul),
.markdown-body :deep(ul ol),
.markdown-body :deep(ol ol) {
  margin: 4px 0;
}

/* 任务列表样式 */
.markdown-body :deep(input[type="checkbox"]) {
  margin-right: 8px;
  vertical-align: middle;
}

.markdown-body :deep(li input[type="checkbox"]) {
  margin-right: 8px;
  margin-top: 0;
}

/* 引用块样式 */
.markdown-body :deep(blockquote) {
  border-left: 4px solid #0e639c;
  padding: 12px 16px;
  margin: 16px 0;
  background: #1e1e1e;
  border-radius: 0 4px 4px 0;
  color: #b4b4b4;
  font-style: italic;
}

.markdown-body :deep(blockquote p) {
  margin: 8px 0;
}

.markdown-body :deep(blockquote > :first-child) {
  margin-top: 0;
}

.markdown-body :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

/* 链接样式 */
.markdown-body :deep(a) {
  color: #4fc3f7;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: all 0.2s;
}

.markdown-body :deep(a:hover) {
  color: #81d4fa;
  border-bottom-color: #4fc3f7;
}

/* 表格样式 */
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  overflow: hidden;
}

.markdown-body :deep(table th),
.markdown-body :deep(table td) {
  padding: 10px 14px;
  border: 1px solid #3c3c3c;
  text-align: left;
}

.markdown-body :deep(table th) {
  background: #2d2d30;
  font-weight: 600;
  color: #ffffff;
}

.markdown-body :deep(table tr:nth-child(even)) {
  background: #252526;
}

.markdown-body :deep(table tr:hover) {
  background: #2d2d30;
}

/* 水平分割线 */
.markdown-body :deep(hr) {
  border: none;
  border-top: 2px solid #3c3c3c;
  margin: 24px 0;
}

/* 强调和斜体 */
.markdown-body :deep(strong) {
  font-weight: 600;
  color: #ffffff;
}

.markdown-body :deep(em) {
  font-style: italic;
  color: #e8e8e8;
}

.markdown-body :deep(strong em),
.markdown-body :deep(em strong) {
  font-weight: 600;
  font-style: italic;
  color: #ffffff;
}

/* 删除线 */
.markdown-body :deep(del),
.markdown-body :deep(s) {
  text-decoration: line-through;
  color: #858585;
}

/* 图片样式 */
.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 16px 0;
  border: 1px solid #3c3c3c;
}

/* 改善滚动条样式 */
.markdown-body :deep(pre::-webkit-scrollbar) {
  height: 8px;
}

.markdown-body :deep(pre::-webkit-scrollbar-track) {
  background: #1e1e1e;
  border-radius: 4px;
}

.markdown-body :deep(pre::-webkit-scrollbar-thumb) {
  background: #424242;
  border-radius: 4px;
}

.markdown-body :deep(pre::-webkit-scrollbar-thumb:hover) {
  background: #4e4e4e;
}

.no-content {
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}
</style>
