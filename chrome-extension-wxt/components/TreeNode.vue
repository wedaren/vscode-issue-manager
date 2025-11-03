<template>
  <div class="tree-node">
    <!-- 节点标题头部 -->
    <div 
      class="tree-node-header-compact"
      :class="{ expanded: isExpanded }"
      @click="toggleExpand"
    >
      <span class="toggle-icon">{{ isExpanded ? '▼' : '▶' }}</span>
      <span class="node-title">{{ nodeTitle }}</span>
    </div>

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
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface TreeNodeProps {
  node: {
    id: string;
    title: string;
    filename: string;
    content?: string;
    mtime?: number;
    children?: any[];
  };
  level: number;
}

const props = defineProps<TreeNodeProps>();

const isExpanded = ref(false);

const nodeTitle = computed(() => {
  // 优先使用 markdown 内容的第一个 H1 标题
  if (props.node.content) {
    const titleMatch = props.node.content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      return titleMatch[1];
    }
  }
  return props.node.title || '未命名';
});

const hasChildren = computed(() => {
  return props.node.children && props.node.children.length > 0;
});

const parsedMarkdown = computed(() => {
  if (!props.node.content) return '';
  return parseMarkdown(props.node.content);
});

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}

function parseMarkdown(markdown: string): string {
  if (!markdown) return '';
  
  let html = markdown;
  
  // 转义 HTML 特殊字符
  const escapeMap: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  };
  html = html.replace(/[&<>]/g, char => escapeMap[char] || char);
  
  // 代码块
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 标题
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
  
  // 粗体和斜体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  
  // 引用块
  html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
  
  // 无序列表
  html = html.replace(/^\- (.*$)/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  // 有序列表
  html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');
  
  // 段落
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  
  // 清理多余的空段落
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[123]>)/g, '$1');
  html = html.replace(/(<\/h[123]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  
  return html;
}
</script>

<style scoped>
.tree-node {
  margin-bottom: 8px;
}

.tree-node-header-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  background: #2d2d30;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  transition: all 0.2s;
  user-select: none;
}

.tree-node-header-compact:hover {
  background: #37373d;
  border-color: #0e639c;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.tree-node-header-compact.expanded {
  background: #37373d;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom-color: transparent;
}

.toggle-icon {
  font-size: 10px;
  color: #858585;
  min-width: 12px;
  text-align: center;
  transition: transform 0.2s;
}

.node-title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #cccccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node-content {
  background: #2d2d30;
  border: 1px solid #3c3c3c;
  border-top: none;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  padding: 16px 20px;
  margin-bottom: 8px;
}

.tree-node-children {
  margin-left: 20px;
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid #3c3c3c;
}

.markdown-body {
  font-size: 13px;
  line-height: 1.6;
  color: #d4d4d4;
}

.markdown-body h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 16px 0 12px;
  color: #ffffff;
  border-bottom: 1px solid #3c3c3c;
  padding-bottom: 8px;
}

.markdown-body h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 14px 0 10px;
  color: #ffffff;
}

.markdown-body h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 12px 0 8px;
  color: #cccccc;
}

.markdown-body p {
  margin: 8px 0;
}

.markdown-body code {
  background: #1e1e1e;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  color: #ce9178;
}

.markdown-body pre {
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
}

.markdown-body pre code {
  background: none;
  padding: 0;
  color: #d4d4d4;
}

.markdown-body ul,
.markdown-body ol {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-body li {
  margin: 4px 0;
}

.markdown-body blockquote {
  border-left: 3px solid #0e639c;
  padding-left: 12px;
  margin: 8px 0;
  color: #858585;
  font-style: italic;
}

.markdown-body a {
  color: #569cd6;
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

.markdown-body strong {
  font-weight: 600;
  color: #ffffff;
}

.markdown-body em {
  font-style: italic;
  color: #cccccc;
}

.no-content {
  color: #858585;
  font-size: 13px;
  font-style: italic;
}
</style>
